import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
  ILayoutRestorer,
} from '@jupyterlab/application';
import {
  ICommandPalette,
  MainAreaWidget,
  WidgetTracker,
} from '@jupyterlab/apputils';
import { IMainMenu } from '@jupyterlab/mainmenu';
import { Menu } from '@lumino/widgets';
import {
  INotebookTracker
} from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';

import {
  ToolbarWidget
} from './jupyter-pilot-widget';
import SharedService from './shared-service';
import { XtermWidget } from './xterm-widget';


const extension: JupyterFrontEndPlugin<void> = {
  id: 'jupyter-pilot-frontend',
  autoStart: true,
  requires: [ICommandPalette, ILayoutRestorer, INotebookTracker, ISettingRegistry, IMainMenu],
  activate: (
    app: JupyterFrontEnd,
    palette: ICommandPalette,
    restorer: ILayoutRestorer,
    notebookTracker: INotebookTracker,
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
        sharedService.setOpenAIAPIKey(settings.get('openai_api_key').composite as string);

        // Listen for your setting changes.
        settings.changed.connect(() => {
            console.log("Using model: " + settings.get('llm_backend').composite);
            sharedService.setModel(settings.get('llm_backend').composite as string);
            sharedService.setTemp(settings.get('llm_temp').composite as number);
            sharedService.setOpenAIAPIKey(settings.get('openai_api_key').composite as string);
        });
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


    app.docRegistry.addWidgetExtension('Notebook', new ToolbarWidget(sharedService, notebookTracker, app));

  },
};

export default extension;
