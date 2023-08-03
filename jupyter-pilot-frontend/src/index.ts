import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
  ILayoutRestorer,
  ILabShell
} from '@jupyterlab/application';
import {
  ICommandPalette,
  MainAreaWidget,
  WidgetTracker,
  CommandToolbarButton,
} from '@jupyterlab/apputils';
import {
  LoggerRegistry,
  LogConsolePanel,
} from '@jupyterlab/logconsole';
import { clearIcon, listIcon } from '@jupyterlab/ui-components';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { IMainMenu } from '@jupyterlab/mainmenu';
import { Menu } from '@lumino/widgets';
import {
  INotebookTracker
} from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';

import LogLevelSwitcher from './logLevelSwitcher';
import {
  ToolbarWidget
} from './jupyter-pilot-widget';
import SharedService from './shared-service';
import { XtermWidget } from './xterm-widget';


/**
async function callShutdown(access_token: string) {
  try {
    const baseUrl = window.location.origin;
    const xsrfToken = document.cookie.split('; ').find(row => row.startsWith('_xsrf=')).split('=')[1];

    console.log("callShutdown() - baseUrl", baseUrl);
    console.log("callShutdown() - xsrfToken", xsrfToken);
    console.log("callShutdown() - access_token", access_token);

  } catch (error) {
    console.error("Error fetching data from server extension:", error);
  }
}
*/


const extension: JupyterFrontEndPlugin<void> = {
  id: 'jupyter-pilot-frontend',
  autoStart: true,
  requires: [ICommandPalette, IRenderMimeRegistry, ILayoutRestorer, INotebookTracker, ILabShell, ISettingRegistry, IMainMenu],
  activate: (
    app: JupyterFrontEnd,
    palette: ICommandPalette,
    rendermime: IRenderMimeRegistry,
    restorer: ILayoutRestorer,
    notebookTracker: INotebookTracker,
    labShell: ILabShell,
    settingsRegistry: ISettingRegistry,
    mainMenu: IMainMenu 
  ) => {
    const { commands } = app;

    const sharedService = new SharedService("gpt-3.5-turbo-16k", 1);


    // Get the settings for your extension
    settingsRegistry.load("jupyter-pilot-frontend:settings").then(settings => {
        console.log("Using model: " + settings.get('llm_backend').composite);
        sharedService.setModel(settings.get('llm_backend').composite as string);
        sharedService.setTemp(settings.get('llm_temp').composite as number);

        // Listen for your setting changes.
        settings.changed.connect(() => {
            console.log("Using model: " + settings.get('llm_backend').composite);
            sharedService.setModel(settings.get('llm_backend').composite as string);
            sharedService.setTemp(settings.get('llm_temp').composite as number);
        });
    });




    //let access_token: string;

    labShell.disposed.connect(() => {
      console.log('call backend to shutdown task');
    });

    // Shutdown when no activity or user interaction for 30 min
    let shutdownTimeout: number | null = null;
    const resetTimer = () => {
      if (shutdownTimeout !== null) {
        window.clearTimeout(shutdownTimeout);
      }
      shutdownTimeout = window.setTimeout(() => {
        const activeNotebook = notebookTracker.currentWidget;
        let isKernelRunning = false;
        if (activeNotebook) {
          const kernel = activeNotebook.sessionContext.session.kernel;
          if (kernel && kernel.status === 'busy') {
            isKernelRunning = true;
          }
        }
        if (!isKernelRunning) {
          console.log("call backend to shutdown task instance");
          resetTimer(); // retry if the backend is down
        }
      }, 60000); // 30 minutes in milliseconds: 1800000
    };
    
    // Reset the timer whenever the user interacts with the application
    document.addEventListener('mousemove', resetTimer);
    document.addEventListener('mousedown', resetTimer);
    document.addEventListener('keydown', resetTimer);
    document.addEventListener('scroll', resetTimer);
    document.addEventListener('touchstart', resetTimer);


    /**
    window.addEventListener('message', (event) => {
      // Check the origin of the message to ensure it's from a trusted source
      if (event.origin !== window.location.origin) {
          console.warn("event not from window origin")
          return;
      }

      // Receive and process the message
      const receivedData = event.data;
      console.log('Data received:', receivedData);

      access_token = receivedData;

      // Perform any action with the received data, e.g., store it in a notebook cell
    });
    */

    // Console
    let logConsolePanel: LogConsolePanel = null;
    let logConsoleWidget: MainAreaWidget<LogConsolePanel> = null;

    const tracker = new WidgetTracker<MainAreaWidget<LogConsolePanel>>({
      namespace: 'jupyter-pilot-console',
    });

    restorer.restore(tracker, {
      command: 'jupyter-pilot-console:open',
      name: () => 'jupyter-pilot-console',
    });

    commands.addCommand('jupyter-pilot-console:clear', {
      execute: () => logConsolePanel?.logger?.clear(),
      icon: clearIcon,
      isEnabled: () => !!logConsolePanel && logConsolePanel.source !== null,
      label: 'Clear Log',
    });
    commands.addCommand('jupyter-pilot-console:level', {
      execute: (args: any) => {
        if (logConsolePanel?.logger) {
          logConsolePanel.logger.level = args.level;
        }
      },
      isEnabled: () => !!logConsolePanel && logConsolePanel.source !== null,
      label: (args: any) => `Set Log Level to ${args.level as string}`,
    });

    const createLogConsoleWidget = (): void => {
      logConsolePanel = new LogConsolePanel(
        new LoggerRegistry({
          defaultRendermime: rendermime,
          maxLength: 1000,
        })
      );

      logConsolePanel.source = 'Labpilot console';

      logConsoleWidget = new MainAreaWidget<LogConsolePanel>({
        content: logConsolePanel,
      });
      logConsoleWidget.addClass('jp-LogConsole');
      logConsoleWidget.title.label = 'Jupyter Pilot ';
      logConsoleWidget.title.icon = listIcon;

      logConsoleWidget.toolbar.addItem(
        'clear',
        new CommandToolbarButton({
          commands: app.commands,
          id: 'jupyter-pilot-console:clear',
        })
      );
      logConsoleWidget.toolbar.addItem(
        'level',
        new LogLevelSwitcher(logConsoleWidget.content)
      );

      logConsoleWidget.disposed.connect(() => {
        logConsoleWidget = null;
        logConsolePanel = null;
        commands.notifyCommandChanged();
      });

      app.shell.add(logConsoleWidget, 'main', { mode: 'split-bottom' });
      tracker.add(logConsoleWidget);

      logConsoleWidget.update();
      commands.notifyCommandChanged();
    };

    commands.addCommand('jupyter-pilot-console:open', {
      label: 'Labpilot console',
      caption: 'Labpilot console.',
      isToggled: () => logConsoleWidget !== null,
      execute: () => {
        if (logConsoleWidget) {
          logConsoleWidget.dispose();
        } else {
          createLogConsoleWidget();
        }
      },
    });

    let xtermWidget: MainAreaWidget<XtermWidget> = null;

    const xtermTracker = new WidgetTracker<MainAreaWidget<XtermWidget>>({
      namespace: 'jupyter-pilot-xterm',
    });

    // Add to restorer
    restorer.restore(xtermTracker, {
      command: 'jupyter-pilot-xterm:open',
      name: () => 'jupyter-pilot-xterm',
    });
    
    const createXtermWidget = (): void => {
      const xtermPanel = new XtermWidget(sharedService, notebookTracker, app);

      xtermWidget = new MainAreaWidget<XtermWidget>({
        content: xtermPanel,
      });
      xtermWidget.addClass('jp-XtermConsole');
      xtermWidget.title.label = 'Labpilot terminal';

      xtermWidget.disposed.connect(() => {
        xtermWidget = null;
        commands.notifyCommandChanged();
      });

      app.shell.add(xtermWidget, 'main', { mode: 'split-right' });
      xtermTracker.add(xtermWidget);

      xtermWidget.update();
      commands.notifyCommandChanged();
    };

    commands.addCommand('jupyter-pilot-xterm:open', {
      label: 'Labpilot terminal',
      caption: 'Labpilot terminal.',
      isToggled: () => xtermWidget !== null,
      execute: () => {
        if (xtermWidget) {
          xtermWidget.dispose();
        } else {
          createXtermWidget();
        }
      },
    });

    let menu = new Menu({ commands });
    menu.title.label = 'Labpilot';

    let commandId = 'jupyter-pilot-console:open';
    menu.addItem({ command: commandId });
    palette.addItem({ command: commandId, category: 'Extension' });

    commandId = 'jupyter-pilot-xterm:open';
    menu.addItem({ command: commandId });
    palette.addItem({ command: commandId, category: 'Extension' });

    mainMenu.addMenu(menu, { rank: 80 });


    app.docRegistry.addWidgetExtension('Notebook', new ToolbarWidget((msg) => logConsolePanel?.logger?.log(msg), sharedService, notebookTracker, app));

    // Start the timer when the extension is activated
    resetTimer();
  },
};

export default extension;
