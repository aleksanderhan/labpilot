c = get_config()
c.NotebookWidget.code_cell_config = {"collapsible": True}
c.NotebookApp.tornado_settings={'headers': {'Content-Security-Policy': "frame-ancestors * 'self' "}}