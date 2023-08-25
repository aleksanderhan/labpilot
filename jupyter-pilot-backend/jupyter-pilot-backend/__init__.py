import asyncio
import multiprocessing
import langchain
from notebook.utils import url_path_join

from .websocket_handler import RefactorWebSocketHandler, DebugWebSocketHandler, ExplainWebSocketHandler
from .terminal.terminal import Terminal

import tracemalloc
tracemalloc.start()

langchain.debug = True


def _jupyter_server_extension_paths():
    return [{
        "module": "jupyter-pilot-backend",
    }]
    

def load_jupyter_server_extension(nbapp):
    web_app = nbapp.web_app
    host_pattern = '.*$'

    refactor_route_pattern = url_path_join(web_app.settings['base_url'], '/refactor')
    web_app.add_handlers(host_pattern, [(refactor_route_pattern, RefactorWebSocketHandler)])

    debug_route_pattern = url_path_join(web_app.settings['base_url'], '/debug')
    web_app.add_handlers(host_pattern, [(debug_route_pattern, DebugWebSocketHandler)])

    explain_route_pattern = url_path_join(web_app.settings['base_url'], '/explain')
    web_app.add_handlers(host_pattern, [(explain_route_pattern, ExplainWebSocketHandler)])

    kernel_manager = web_app.settings['kernel_manager']
    
    # The list of running kernel IDs
    kernel_ids = list(kernel_manager._kernels.keys())

    for kernel_id in kernel_ids:
        kernel = kernel_manager.get_kernel(kernel_id)
        print("kernel_name:", kernel.kernel_name)


    term = Terminal()
    process = multiprocessing.Process(target=lambda: asyncio.run(term.start()))
    process.start()

