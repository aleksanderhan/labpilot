import { Widget } from '@lumino/widgets'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'

import {
  INotebookTracker,
  NotebookModel
} from '@jupyterlab/notebook'
import {
  JupyterFrontEnd
} from '@jupyterlab/application'
import { CodeCellModel, MarkdownCellModel } from "@jupyterlab/cells"


import SharedService from './shared-service'
import Spinner from "./spinner"
import { getCellOutput, CodeBuffer } from './cell-utils'


const xtermjsTheme = {
  foreground: '#F8F8F8',
  background: '#2D2E2C',
  selectionBackground: '#5DA5D533',
  black: '#1E1E1D',
  brightBlack: '#262625',
  red: '#CE5C5C',
  brightRed: '#FF7272',
  green: '#5BCC5B',
  brightGreen: '#72FF72',
  yellow: '#CCCC5B',
  brightYellow: '#FFFF72',
  blue: '#5D5DD3',
  brightBlue: '#7279FF',
  magenta: '#BC5ED1',
  brightMagenta: '#E572FF',
  cyan: '#5DA5D5',
  brightCyan: '#72F0FF',
  white: '#F8F8F8',
  brightWhite: '#FFFFFF'
}

class History<T>{
  private memory: Array<T> = []
  private index: number = -1

  public push(item: T): void {
    if (item) {
      this.memory.unshift(item)
      this.index = -1
    }
  }

  public down(): T {
    if (this.index > -1) {
      this.index--
      return this.memory[this.index]
    }
    return null
  }

  public up(): T {
    if (this.index < this.memory.length - 1) {
      this.index++
      return this.memory[this.index]
    }
    return null
  }

  public resetIndex(): void {
    this.index--
  }

  public getIndex(): number {
    return this.index
  }
}


function color(str: string, colorName = "yellow") {
  const colors: { [key: string]: number[] } = {
      "yellow": [33, 89],
      "blue": [34, 89],
      "green": [32, 89],
      "cyan": [35, 89],
      "red": [31, 89],
      "magenta": [36, 89]
  }
  const _color = colors[colorName]
  const start = "\x1b[" + _color[0] + "m"
  const stop = "\x1b[" + _color[1] + "m\x1b[0m"
  return start + str + stop
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function removeMedia(json: any) {
  if (json.cells) {
    json.cells.forEach(cell => {
      if (cell.cell_type === "code" && cell.outputs) {
        cell.outputs = cell.outputs.map((output: any) => keepProperty(output, "text/plain"))
      }
    })
  }
}

function keepProperty(obj: any, prop: string) {
  return { [prop]: obj[prop] };
}

export class XtermWidget extends Widget {
  private term: Terminal
  private ws: WebSocket;
  private fitAddon: FitAddon
  private curr_line: string = ""
  private curr_index: number = 0
  private history: History<string> = new History()
  private mode: string = "default"
  
  private waitingForAnswer: boolean = false
  private justStarted: boolean = false

  // Spinner
  private spinner: Spinner

  // Select option variables
  private select_question: string = ""
  private select_options: Array<string> = []
  private select_index: number = null

  private message: string = "";

  constructor(
    private sharedService: SharedService,
    private notebookTracker: INotebookTracker, 
    private app: JupyterFrontEnd
  ) {
    super()

    this.term = new Terminal({
      cursorBlink: true, 
      allowProposedApi: true,
      fontFamily: '"Fira Code", courier-new, courier, monospace, "Powerline Extra Symbols"',
      theme: xtermjsTheme,
      convertEol: true
    })

    this.fitAddon = new FitAddon()
    this.term.loadAddon(this.fitAddon)
    this.term.loadAddon(new WebLinksAddon())
    
    this.term.onData(this.handleUserInput.bind(this))

    this.ws = new WebSocket("ws://localhost:8080", "echo-protocol");
    this.ws.onmessage = this.handleResponse.bind(this)
    this.ws.onerror = (event: Event) => {
      console.error('Primary WebSocket error observed:', event)
    }
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({"method": "clear"}))
    }

    this.term.write("$ ")
  }

  private handleResponse(msg: any): void {
    let response = JSON.parse(msg.data)
    if (response.method !== "default") console.log(response)

    if (response.start === true && response.method === "default") {
      this.justStarted = true // Handling the false start
    } else if (this.justStarted === true && response.method === "default") {
      this.justStarted = false
      if (response.done === false) {
        this.spinner.stop()
      }
    }

    switch (response.method) {
      case "systemError":
        this.systemError(response.message)
        break
      case "openNotebook":
        this.openNotebook(response.request.filename)
        break
      case "readCell":
        this.readCell(response.request.index, response.request.filename)
        break
      case "insertCodeCell":
        this.insertCodeCell(response.request.code, response.request.index, response.request.filename)
        break
      case "insertMarkdownCell":  
        this.insertMarkdownCell(response.request.text, response.request.index, response.request.filename)
        break
      case "editCodeCell":
        this.editCodeCell(response.request.code, response.request.index, response.request.filename)
        break
      case "editMarkdownCell":
        this.editMarkdownCell(response.request.text, response.request.index, response.request.filename)
        break
      case "runCode":
        this.runCodeCell(response.request.index, response.request.filename)
        break
      case "deleteCell":
        this.deleteCell(response.request.index, response.request.filename)
        break
      case "readNotebook":
        this.readNotebook(response.request.filename)
        break
      case "default":
      default:
        if (response.start === false && response.done === false) {
          if (response.message !== null) {
            this.term.write(color(response.message, "magenta"))
            this.message += response.message
          }
        }
        if (response.done === true && this.waitingForAnswer === false) {
          const pattern = /(.*\?)((?:\n- .*)+)/
          const match = this.message.match(pattern)
          if (match) {
            this.spinner.stop()

            this.select_index = 0
            this.select_question = match[1]
            this.select_options = match[2].trim()
                                          .split('\n')
                                          .map(option => option.substring(2).trim()) || []

            this.term.write("\x1B[?25l") // Hide cursor
            this.term.write("\n")
            //this.term.write('\x1b[1A')  // Move line up
            //this.term.write("\r\x1b[K") // Delete line
            this.renderSelect()
            this.mode = "select"
          } else {
            this.term.write("\n$ ")
          }
          this.message = ""
        }
        if (response.start === false) {
          this.waitingForAnswer = false
        }
    }
  }

  private renderSelect() {
    this.clearSelect()
    
    this.term.writeln(color("\n" + this.select_question + " (ctrl+d to exit)", "magenta"))
    for (let i = 0; i < this.select_options.length; i++) {
      let opt = ""
      if (i === this.select_index) {
        opt = "> " + this.select_options[i]
        this.term.writeln(color(opt, "cyan"))
      } else {
        opt = "  " + this.select_options[i]
        this.term.writeln(opt)
      }
    }
  }

  private clearSelect() {
    let extra_lines = 1
    extra_lines += Math.ceil(((this.select_question.length + 17) / this.term.cols) - 1) // 17 char in additional text concatenated to select_question
    this.select_options.forEach(element => {
      extra_lines += Math.ceil(((element.length + 2) / this.term.cols) - 1)
    })

    for (let i = this.select_options.length + extra_lines; i >= 0; i--) {
      this.term.write('\x1b[1A')  // Move line up
      this.term.write("\r\x1b[K") // Delete line
    }    
  }

  private systemError(message: string) {
    this.spinner.stop()
    this.waitingForAnswer = false
    this.term.writeln(color(message, "red"))
  }

  private async openNotebook(filename: string) {
    let data
    try {
      const { commands } = this.app
      commands.execute('docmanager:open', { path: filename, options: { mode: 'split-left' } })
      await sleep(500)
      
      data = {
        "message": "Notebook successfully created with filename: " + filename
      }
    } catch (error) {
      data = {
        "message": "ERROR: " + error,
        "system_message": true
      }
    } finally {
      this.sendAnswer(data, "openNotebook")
    }
  }

  private async readCell(indexStr: string, filename: string) {
    let data
    try {
      if (filename) {
        const { commands } = this.app
        commands.execute('docmanager:open', { path: filename, options: { mode: 'split-left' } })
        await sleep(500)
      }
      const index = parseInt(indexStr)
      const model = this.notebookTracker.currentWidget.content.model as NotebookModel
      const modelJson = model.toJSON()
      const cell = modelJson.cells[index]
      data = {
        "message": {
          "cell_type": cell.cell_type,
          "content": cell.source
        }
      }
    } catch (error) {
      data = {
        "message": "ERROR: " + error,
        "system_message": true
      }
    } finally {
      this.sendAnswer(data, "readCell")
    }
  }

  private async insertCodeCell(code: string, indexstr: string, filename: string) {
    let data
    try {
      if (filename) {
        const { commands } = this.app
        commands.execute('docmanager:open', { path: filename, options: { mode: 'split-left' } })
        await sleep(500)
      }
      const index = parseInt(indexstr)
      const model = this.notebookTracker.currentWidget.content.model
      const codeCell = model.contentFactory.createCell('code', {})
      codeCell.value.text = code
      model.cells.insert(index, codeCell)
      data = {
        "message": "Inserted code at index " + index + " successfully"
      }
    } catch (error) {
      data = {
        "message": "ERROR: " + error,
        "system_message": true
      }
    } finally {
      this.sendAnswer(data, "insertCodeCell")
    }
  }

  private async insertMarkdownCell(markdown: string, indexstr: string, filename: string) {
    let data
    try {
      if (filename) {
        const { commands } = this.app
        commands.execute('docmanager:open', { path: filename, options: { mode: 'split-left' } })
        await sleep(500)
      }
      const index = parseInt(indexstr)
      const model = this.notebookTracker.currentWidget.content.model
      const cellModel = model.contentFactory.createCell('markdown', {})
      cellModel.value.text = markdown
      model.cells.insert(index, cellModel)

      // Insert text into the markdown cell
      cellModel.value.text = markdown
      // Set the new cell as the active cell
      this.notebookTracker.currentWidget.content.activeCellIndex = index
      // Programmatically run the cell
      this.app.commands.execute('notebook:run-cell')
      data = {
        "message": "Inserted markdown text at index " + index + " successfully"
      }
    } catch (error) {
      data = {
        "message": "ERROR: " + error,
        "system_message": true
      }
    } finally {
      this.sendAnswer(data, "insertMarkdownCell")
    }
  }

  private async editCodeCell(code: string, indexstr: string, filename: string) {
    let data
    try {
      if (filename) {
        const { commands } = this.app
        commands.execute('docmanager:open', { path: filename, options: { mode: 'split-left' } })
        await sleep(500)
      }
      const index = parseInt(indexstr)
      const notebookPanel = this.notebookTracker.currentWidget
      const notebook = notebookPanel.content
      const cellModel = notebook.model.cells.get(index)
      if (cellModel instanceof CodeCellModel) {
        const initial_code = cellModel.value.text
        // Save initial code from active cell
        if ((cellModel as any).code_buffer == null) { 
          (cellModel as any).code_buffer = new CodeBuffer();
        }
        (cellModel as any).code_buffer.addUndo(initial_code);
        (cellModel as any).code_buffer.clearRedoBuffer();

        cellModel.value.text = code
        data = {
          "message": "Edited code cell at index " + index + " successfully."
        }
      } else {
        data = {
          "message": "ERROR: Cell with index " + index + " is not a code cell."
        }
      }
    } catch (error) {
      data = {
        "message": "ERROR: " + error,
        "system_message": true
      }
    } finally {
      this.sendAnswer(data, "editCodeCell")
    }
  }

  private async editMarkdownCell(text: string, indexstr: string, filename: string) {
    let data
    try {
      if (filename) {
        const { commands } = this.app
        commands.execute('docmanager:open', { path: filename, options: { mode: 'split-left' } })
        await sleep(500)
      }
      const index = parseInt(indexstr)
      const notebookPanel = this.notebookTracker.currentWidget
      const notebook = notebookPanel.content
      const cellModel = notebook.model.cells.get(index)

      if (cellModel instanceof MarkdownCellModel) {
        cellModel.value.text = text

        // Set the new cell as the active cell
        this.notebookTracker.currentWidget.content.activeCellIndex = index
        // Programmatically run the cell
        this.app.commands.execute('notebook:run-cell')

        data = {
          "message": "Edited markdown cell at index " + index + " successfully."
        }
      } else {
        data = {
          "message": "ERROR: Cell at index " + index + " is not a markdown cell."
        }
      }
    } catch (error) {
      data = {
        "message": "ERROR: " + error,
        "system_message": true
      }
    } finally {
      this.sendAnswer(data, "editMarkdownCell")
    }
  }

  private async runCodeCell(index: number, filename: string) {
    let data
    try {
      if (filename) {
        const { commands } = this.app
        commands.execute('docmanager:open', { path: filename, options: { mode: 'split-left' } })
        await sleep(500)
      }
      const currentNotebookPanel = this.notebookTracker.currentWidget
      currentNotebookPanel.content.activeCellIndex = index

      const activeCell = currentNotebookPanel.content.activeCell

      if (activeCell.model instanceof CodeCellModel) {
        const sessionContext = currentNotebookPanel.sessionContext
        const idlePromise = new Promise(resolve => {
          const slot = (sender: any, status: string) => {
            if (status === 'idle') {
              sessionContext.statusChanged.disconnect(slot)
              resolve(null)
            }
          };
          sessionContext.statusChanged.connect(slot)
        })

        // Run the cell.
        this.app.commands.execute('notebook:run-cell')
        await idlePromise
        await sleep(500) // Waiting for outputs to settle
        
        const output = getCellOutput(activeCell.model)
        console.log(output)
        data = {
          "message": {
            "output": output.outputText,
            "error": output.errorText
          }
        }
      } else {
        data = {
          "message": "The cell with index " + index + " is not a code cell.",
          "system_message": true
        }
      }
    } catch (error) {
      data = {
        "message": "ERROR: " + error,
        "system_message": true
      }
    } finally {
      this.sendAnswer(data, "runCode")
    }
  }

  private async deleteCell(indexstr: string, filename: string) {
    let data
    try {
      if (filename) {
        const { commands } = this.app
        commands.execute('docmanager:open', { path: filename, options: { mode: 'split-left' } })
        await sleep(500)
      }
      const index = parseInt(indexstr)
      const model = this.notebookTracker.currentWidget.content.model
      model.cells.remove(index)
      data = {
        "message": "Deleted cell at index " + index + " successfully"
      }
    } catch (error) {
      data = {
        "message": "ERROR: " + error,
        "system_message": true
      }
    } finally {
      this.sendAnswer(data, "deleteCell")
    }
  }

  private async readNotebook(filename: string) {
    let data
    try {
      if (filename) {
        const { commands } = this.app
        commands.execute('docmanager:open', { path: filename, options: { mode: 'split-left' } })
        await sleep(500)
      }
      const notebookPanel = this.notebookTracker.currentWidget
      const notebookJson = notebookPanel.model.toJSON()
      removeMedia(notebookJson)
      console.log("notebookJson", notebookJson)
      data = {
        "message": notebookJson
      }
    } catch (error) {
      data = {
        "message": "ERROR: " + error,
        "system_message": true
      }
    } finally {
      this.sendAnswer(data, "readNotebook")
    }
  }

  private handleUserInput(input: string) {
    switch (input) {
      case '\r':
      case '\n':
        this.enter()
        break
      case '\x1b[A':
        this.upArrow()
        break
      case '\x1b[B':
        this.downArrow()
        break
      case '\x1b[D':
        this.leftArrow()
        break
      case '\x1b[C':
        this.rightArrow()
        break
      case '\x7f':
        this.backspace()
        break
      case '\x04':
        this.ctrlD()
        break
      default:
        if (this.mode === "default") {
          const firstPart = this.curr_line.substring(0, this.curr_index)
          const secondPart = this.curr_line.substring(this.curr_index)
          this.curr_line = firstPart + input + secondPart
          this.curr_index += input.length
          this.term.write(input + secondPart)
          this.term.write('\x1b[D'.repeat(secondPart.length))
        }
    }
  }

  private ctrlD() {
    if (this.mode === "select") {
      const data = {
        "message": "None of the above.",
        "model": this.sharedService.getModel(), 
        "temp": this.sharedService.getTemp(),
        "openai_api_key": this.sharedService.getOpenAIAPIKey()
      }
      this.ws.send(JSON.stringify(data))
      this.mode = "default"
    }
  }

  private backspace() {
    if (this.curr_index > 0) {
      if (this.curr_line.length == this.curr_index) {
        this.curr_line = this.curr_line.slice(0, this.curr_index - 1)
        this.term.write("\b \b") // Delete one char
      } else {
        const left = this.curr_line.slice(0, this.curr_index - 1)
        const right = this.curr_line.slice(this.curr_index, this.curr_line.length + 1)
        this.curr_line = left + right
        this.term.write("\b \b") // Delete one char
        this.term.write(right + " ")
        this.term.write('\x1b[D'.repeat(right.length + 1)) // Move cursor to the left
      }
      this.curr_index -= 1
    } else {
      this.history.resetIndex()
    }
  }

  private leftArrow() {
    if (this.curr_index > 0) {
      this.curr_index -= 1
      this.term.write('\x1b[D') // Move cursor to the left
    }
  }

  private rightArrow() {
    if (this.curr_index < this.curr_line.length) {
      this.curr_index += 1
      this.term.write('\x1b[C') // Move cursor to the right
    }
  }

  private enter() {
    switch(this.mode) {
      case "select":
        const answer = this.select_options[this.select_index]
        this.term.writeln(color("\nYou selected: ", "cyan") + answer)
        const data = {
          "message": answer,
          "model": this.sharedService.getModel(), 
          "temp": this.sharedService.getTemp(),
          "openai_api_key": this.sharedService.getOpenAIAPIKey()
        }
        this.ws.send(JSON.stringify(data))
        this.spinner = new Spinner(this.term)
        this.spinner.color("green")
        this.spinner.spin("dots")
        this.mode = "default"
        break
      case "default":
      default:
        if (this.curr_line) {
          switch (this.curr_line) {
            case "help":
              const help_text = `\nTODO: This terminal is bla bla bla...`
              this.term.writeln(help_text)
              break
            case "clear":
              this.term.reset()
              this.term.write("$ ")
              this.ws.send(JSON.stringify({"method": "clear"}))
              break
            default:
              this.history.resetIndex()
              const data = { 
                "message": this.curr_line,
                "model": this.sharedService.getModel(), 
                "temp": this.sharedService.getTemp(),
                "openai_api_key": this.sharedService.getOpenAIAPIKey()
              }
              this.term.write("\n")
              this.ws.send(JSON.stringify(data))
              this.spinner = new Spinner(this.term)
              this.spinner.color("green")
              this.spinner.spin("dots")
              this.waitingForAnswer = true;
          }
          this.history.push(this.curr_line)
          this.curr_line = ""
        } else {
          this.term.write("\n$ ")
        }
        this.curr_index = 0
      }
  }

  private downArrow() {
    switch (this.mode) {
      case "select":
        this.select_index = Math.min(this.select_options.length - 1, this.select_index + 1)
        this.renderSelect()
        break
      case "default":
      default:
        const next_command = this.history.down()
        if (next_command !== null && next_command !== undefined) {
          // Delete the current line before displaying the next command.
          this.term.write('\r\x1b[K$ ' + next_command)
          this.curr_line = next_command
          this.curr_index = next_command.length
        } else if (next_command === undefined) {
          this.term.write('\r\x1b[K$ ')
          this.curr_line = ""
          this.curr_index = 0
        }
    }
  }

  private upArrow() {
    switch (this.mode) {
      case "select":
        this.select_index = Math.max(0, this.select_index - 1)
        this.renderSelect()
        break
      case "default":
      default:
        const prev_command = this.history.up()
        if (prev_command !== null) {
          // Delete the current line before displaying the previous command.
          this.term.write('\r\x1b[K$ ' + prev_command)
          this.curr_line = prev_command
          this.curr_index = prev_command.length
        }
    }
  }

  private sendAnswer(data: any, path: string) {
    this.waitingForAnswer = false
    const ws = new WebSocket("ws://localhost:8081/" + path, "echo-protocol")
    ws.onopen = () => {
      ws.send(JSON.stringify(data))
      ws.close()
    }
    ws.onerror = (event: Event) => {
      console.error('Secondary WebSocket error observed:', event)
    }
  }

  onResize(msg: Widget.ResizeMessage) {
    this.fitAddon.fit()
  }
  
  onAfterAttach(): void {
    this.term.open(this.node)
    this.fitAddon.fit()
  }

  onAfterShow(): void {
    this.fitAddon.fit()
  }

  dispose(): void {
    if (this.mode === "select") {
      const data = {
        "message": "Aborted operation by user.",
        "system_message": true
      }
      this.sendAnswer(data, "select")      
    }
    super.dispose()
  }
}
