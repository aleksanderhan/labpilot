import { ToolbarButton } from '@jupyterlab/apputils';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import { IDisposable, DisposableDelegate } from '@lumino/disposable';
import {
  NotebookPanel,
  INotebookModel,
  INotebookTracker
} from '@jupyterlab/notebook';
import {
  IHtmlLog,
} from '@jupyterlab/logconsole';
import { CodeCell, CodeCellModel } from '@jupyterlab/cells';
import {
  JupyterFrontEnd
} from '@jupyterlab/application';
import { v4 as uuidv4 } from 'uuid';
import { marked } from 'marked';
import { markedHighlight } from "marked-highlight";
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';

import { getCellOutput, CodeBuffer } from './cell-utils';
import SharedService from './shared-service';


export type LogFunction = (msg: IHtmlLog) => void;


/**
 * The toolbar with buttons for the Labpilot extension
 */
export class ToolbarWidget
  implements DocumentRegistry.IWidgetExtension<NotebookPanel, INotebookModel>
{

  private sharedService: SharedService;
  private notebookTracker: INotebookTracker;
  private app: JupyterFrontEnd;

  constructor(sharedService?: SharedService, notebookTracker?: INotebookTracker, app?: JupyterFrontEnd) {
    this.sharedService = sharedService;
    this.notebookTracker = notebookTracker;
    this.app = app;
  }

  /**
   * Create a new extension for the notebook panel widget.
   *
   * @param panel Notebook panel
   * @returns Disposable on the added button
   */
  createNew(
    panel: NotebookPanel
  ): IDisposable {

    // Refactor button
    const refactorAction = () => {
      const refactor = new Refactorer();
      refactor.refactorCell(panel, this.sharedService.getModel(), this.sharedService.getTemp(), this.sharedService.getOpenAIAPIKey());
    };

    const refactorButton = new ToolbarButton({
      className: 'refactor-cell-button',
      label: 'Refactor',
      onClick: refactorAction,
      tooltip: 'Refactor cell based on comments.',
    });

    // Debug button
    const debugAction = () => {
      const debug = new Debugger();
      debug.debugCellOutput(panel, this.sharedService.getModel(), this.sharedService.getTemp(), this.sharedService.getOpenAIAPIKey());
    };

    const debugButton = new ToolbarButton({
      className: 'debug-output-button',
      label: 'Debug',
      onClick: debugAction,
      tooltip: 'Debugs code based on cell output',
    });

    // Explain button
    const explainAction = () => {
      const explain = new Explainer();
      explain.explainCode(panel, this.sharedService.getModel(), this.sharedService.getTemp(), this.sharedService.getOpenAIAPIKey(), this.notebookTracker, this.app);
    };

    const explainButton = new ToolbarButton({
      className: 'explain-code-button',
      label: 'Explain',
      onClick: explainAction,
      tooltip: 'Explain code',
    });

    // Undo button
    const undoAction = () => {
      undo(panel);
    };

    const undoButton = new ToolbarButton({
      className: 'undo-button',
      label: 'Undo',
      onClick: undoAction,
      tooltip: 'Reverts to previous code',
    });

    // Redo button
    const redoAction = () => {
      redo(panel);
    };

    const redoButton = new ToolbarButton({
      className: 'redo-button',
      label: 'Redo',
      onClick: redoAction,
      tooltip: 'Redoes the undo action',
    });

    panel.toolbar.insertItem(10, 'refactorAction', refactorButton);
    panel.toolbar.insertItem(11, 'debugAction', debugButton);
    panel.toolbar.insertItem(12, 'explainAction', explainButton);
    panel.toolbar.insertItem(13, 'undoAction', undoButton);
    panel.toolbar.insertItem(14, 'redoAction', redoButton);

    return new DisposableDelegate(() => {
      refactorButton.dispose();
      debugButton.dispose();
      explainButton.dispose();
      undoButton.dispose();
      redoButton.dispose();
    });
  }
}


class Refactorer {

  private ws: WebSocket;

  public refactorCell(notebookPanel: NotebookPanel, model: string, temp: number, openai_api_key: string) {
    console.log("REFACTOR - using model: " + model)
    const activeCell = notebookPanel.content.activeCell as CodeCell
    const cellModel = activeCell.model as CodeCellModel

    if (cellModel && cellModel.type === 'code') {
      const initial_code = cellModel.value.text; // Get the code from the active cell

      // Save initial code from active cell
      if ((cellModel as any).code_buffer == null) { 
        (cellModel as any).code_buffer = new CodeBuffer();
      }
      (cellModel as any).code_buffer.addUndo(initial_code);
      (cellModel as any).code_buffer.clearRedoBuffer();

      // Add unique id if not exist:
      if ((cellModel as any).uniqueId == null) {
        (cellModel as any).uniqueId = uuidv4();
      }

      this.ws = new WebSocket("ws://localhost:8888/refactor", "echo-protocol")
      this.ws.onmessage = this.handleRefactorResponse.bind(this, activeCell)
      this.ws.onerror = (event: Event) => {
        console.error('refactorCell() - WebSocket error observed:', event)
      };
      this.ws.onopen = () => {
        const data = {
          code: initial_code,
          model: model,
          temp: temp,
          cellId: (cellModel as any).uniqueId,
          openai_api_key: openai_api_key
        };
        this.ws.send(JSON.stringify(data))
      };

    } else {
      console.log("no code block")
    }
  }

  private handleRefactorResponse(activeCell: CodeCell, event: MessageEvent) {
    const data = JSON.parse(event.data);

    const cellModel = activeCell.model as CodeCellModel;
    
    if (data.start === true) {
      activeCell.inputArea.setPrompt("#"); // Setting activity indicator
      cellModel.value.text = "";
    } else if (data.done === true) {
      const executionCount = cellModel.executionCount;
      activeCell.inputArea.setPrompt(executionCount != null ? executionCount.toString() : "");
      this.ws.close();
    } else {
      cellModel.value.text += data.message;
    }
  }
}

class Debugger {

  private ws: WebSocket
  private secondPass: boolean = false
  private explanation: string

  public debugCellOutput(notebookPanel: NotebookPanel, model: string, temp: number, openai_api_key: string) {
    console.log("DEBUG - using model: " + model)
    const activeCell = notebookPanel.content.activeCell as CodeCell
    const cellModel = activeCell.model as CodeCellModel

    if (cellModel && cellModel.type === 'code') {
      const initial_code = cellModel.value.text
      
      // Save initial code from active cell
      if ((cellModel as any).code_buffer == null) { 
        (cellModel as any).code_buffer = new CodeBuffer();
      }
      (cellModel as any).code_buffer.addUndo(initial_code);
      (cellModel as any).code_buffer.clearRedoBuffer();

      const output = getCellOutput(cellModel)

      this.ws = new WebSocket("ws://localhost:8888/debug", "echo-protocol");
      this.ws.onmessage = this.handleDebugResponse.bind(this, activeCell)
      this.ws.onerror = (event: Event) => {
        console.error('debugCellOutput() - WebSocket error observed:', event)
      };
      this.ws.onopen = () => {
        const data = {
          code: initial_code,
          output: output.outputText,
          error: output.errorText,
          model: model,
          temp: temp,
          openai_api_key: openai_api_key
        };
        this.ws.send(JSON.stringify(data))
      };
    } else {
      console.log("no code block");
    }
  }

  private handleDebugResponse(activeCell: CodeCell, event: MessageEvent) {
    const data = JSON.parse(event.data)

    const cellModel = activeCell.model as CodeCellModel
    
    if (this.secondPass === true) {
      if (data.start === true) {
        this.explanation = "";
        sendNotification("debugNotification", this.explanation)
      } else if (data.done === true) {
        this.ws.close()
      } else {
        this.explanation += data.message
        sendNotification("debugNotification", this.explanation)
      }
    } else {
      if (data.start === true) {
        activeCell.inputArea.setPrompt("#") // Setting activity indicator
        cellModel.value.text = ""
      } else if (data.done === true) {
        const executionCount = cellModel.executionCount
        activeCell.inputArea.setPrompt(executionCount != null ? executionCount.toString() : "")
        this.secondPass = true
      } else {
        cellModel.value.text += data.message
      }
    }
  }
}

class Explainer {

  private explanationCell: any;
  private ws: WebSocket;

  public explainCode(notebookPanel: NotebookPanel, model: string, temp: number, openai_api_key: string, notebookTracker: INotebookTracker, app: JupyterFrontEnd) {
    console.log("EXPLAIN - using model:" + model);
    const activeCell = notebookPanel.content.activeCell as CodeCell;
    const cellModel = activeCell.model as CodeCellModel;

    if (cellModel && cellModel.type === 'code') {
      const code = cellModel.value.text;
      this.ws = new WebSocket("ws://localhost:8888/explain", "echo-protocol");
      this.ws.onmessage = this.handleExplainResponse.bind(this, notebookTracker, app);
      this.ws.onerror = (event: Event) => {
        console.error('explainCode() - WebSocket error observed:', event);
      };
      this.ws.onopen = () => {
        const data = {
          code: code,
          model: model,
          temp: temp,
          openai_api_key: openai_api_key
        };
        this.ws.send(JSON.stringify(data));
      };
    } else {
      console.log("no code block");
    }
  }

  private handleExplainResponse(notebookTracker: INotebookTracker, app: JupyterFrontEnd, event: MessageEvent) {
    const data = JSON.parse(event.data);

    const activeCellIndex = notebookTracker.currentWidget.content.activeCellIndex;

    if (data.start === true) {
      // Create a new markdown cell below the code cell to be explained
      const model = notebookTracker.currentWidget.content.model;
      this.explanationCell = model.contentFactory.createCell('markdown', {});
      model.cells.insert(activeCellIndex + 1, this.explanationCell);
    } else if (data.done === true) {
      // Set the new cell as the active cell
      notebookTracker.currentWidget.content.activeCellIndex = activeCellIndex + 1;
      // Programmatically run the cell
      app.commands.execute('notebook:run-cell');
      this.ws.close();
    } else {
      // Insert explanation text into the markdown cell
      this.explanationCell.value.text += data.message;
    }
  }
}

function undo(notebookPanel: NotebookPanel) {
  const activeCell = notebookPanel.content.activeCell as CodeCell;
  const cellModel = activeCell.model as CodeCellModel;

  if (cellModel && cellModel.type === 'code') {
    // Switching the cells code from current_code to previous_code
    const current_code = cellModel.value.text;

    const code_buffer = (cellModel as any).code_buffer;
    const previous_code = code_buffer.getUndo();
    if (previous_code) {
      cellModel.value.text = previous_code;
      code_buffer.addRedo(current_code);
    }
  } else {
    console.log("no code block");
  }
}

function redo(notebookPanel: NotebookPanel) {
  const activeCell = notebookPanel.content.activeCell as CodeCell;
  const cellModel = activeCell.model as CodeCellModel;

  if (cellModel && cellModel.type === 'code') {
    // Switching the cells code from current_code to previous_code
    const current_code = cellModel.value.text;
    
    const code_buffer = (cellModel as any).code_buffer;
    const previous_code = code_buffer.getRedo();
    if (previous_code) {
      cellModel.value.text = previous_code;
      code_buffer.addUndo(current_code);
    }
  } else {
    console.log("no code block");
  }
}


function sendNotification(id: string, text: string) {
  marked.use(markedHighlight({
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    }
  }));

  let notification = document.getElementById(id);
  // If there is already a notification, update its text
  if (notification) {
    const dirtyMarkdownHTML = marked.parse(text);
    const cleanHTML = DOMPurify.sanitize(dirtyMarkdownHTML);
    const textDiv = document.getElementById(id + 'Text');
    textDiv.innerHTML = cleanHTML;
    return;
  }

  notification = document.createElement("div");
  notification.id = id;
  notification.style.position = "fixed";
  notification.style.bottom = "10px";
  notification.style.right = "10px";
  notification.style.zIndex = "999";
  notification.style.padding = "10px";
  notification.style.backgroundColor = "#F5F5F5"; //"#FFFACD";
  notification.style.border = "2px solid black";
  notification.style.color = "black";
  //notification.style.fontWeight = "bold";
  notification.style.borderRadius = "5px";
  notification.style.width = `${window.innerWidth * 0.25}px`;

  const textDiv = document.createElement("div");
  textDiv.id = id + 'Text';
  const dirtyMarkdownHTML = marked.parse(text);
  const cleanHTML = DOMPurify.sanitize(dirtyMarkdownHTML);
  textDiv.innerHTML = cleanHTML;
  notification.appendChild(textDiv);

  const button = document.createElement("button");
  button.innerText = "OK";
  button.style.marginLeft = "10px";
  // Styling the button
  button.style.cursor = "pointer";  // Change cursor on hover
  button.style.backgroundColor = "#1976D2";
  button.style.color = "white";  // White text
  button.style.border = "none";  // Remove border
  button.style.padding = "10px 20px";  // Add some padding
  button.style.textAlign = "center";  // Center the text
  button.style.textDecoration = "none";  // Remove underline
  button.style.display = "inline-block"; 
  button.style.fontSize = "16px";  // Increase font size
  button.style.margin = "4px 2px";
  button.style.transitionDuration = "0.4s";  // Add transition effect
  button.style.borderRadius = "5px";  // Rounded corners

  // Change background color on hover
  button.onmouseover = function(this: HTMLElement) {
    this.style.backgroundColor = "#F57C00";
  }

  // Revert background color on mouseout
  button.onmouseout = function(this: HTMLElement) {
    this.style.backgroundColor = "#1976D2";
  }

  button.addEventListener("click", () => {
    document.body.removeChild(notification);
  });

  notification.appendChild(button);
  document.body.appendChild(notification);
}