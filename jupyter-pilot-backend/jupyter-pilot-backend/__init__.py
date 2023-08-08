import json
import os
import openai
import asyncio
import multiprocessing
import langchain
import tornado.web
import tornado.websocket
import tornado.ioloop
from notebook.utils import url_path_join
from notebook.base.handlers import IPythonHandler
from tornado.web import authenticated
from typing import List, Dict, Any, Union
from langchain.chains.sequential import SequentialChain
from langchain.llms import OpenAI
from langchain.chains import LLMChain
from langchain.prompts import PromptTemplate
from langchain.callbacks.base import BaseCallbackHandler, AsyncCallbackHandler
from langchain.schema import LLMResult, AgentAction
from langchain.chat_models import ChatOpenAI
from langchain.memory import ConversationBufferWindowMemory

from .prompt import debug_template, debug_explain_template, explain_template, refactor_template
from .terminal.terminal import Terminal

import tracemalloc
tracemalloc.start()

langchain.debug = True


class DefaultCallbackHandler(BaseCallbackHandler):
    def __init__(self, writer):
        self.writer = writer

    def on_llm_new_token(self, token: str, **kwargs) -> None:
        if token:
            reply = {
                "message": token, 
                "done": False,
                "start": False
            }
            self.writer(json.dumps(reply))

    def on_llm_start(self, serialized: Dict[str, Any], prompts: List[str], **kwargs: Any) -> None:
        reply = {
            "done": False,
            "start": True
        }
        self.writer(json.dumps(reply))

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        reply = {
            "done": True,
            "start": False
        }
        self.writer(json.dumps(reply))
    
    def on_llm_error(self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any) -> Any:
        """Run when LLM errors."""
        print("error", error)

    def on_chain_start(self, serialized: Dict[str, Any], inputs: Dict[str, Any], **kwargs: Any) -> Any:
        print(f"on_chain_start {serialized['name']}")

    def on_tool_start(self, serialized: Dict[str, Any], input_str: str, **kwargs: Any) -> Any:
        print(f"on_tool_start {serialized['name']}")

    def on_agent_action(self, action: AgentAction, **kwargs: Any) -> Any:
        print(f"on_agent_action {action}")


class RefactorWebSocketHandler(tornado.websocket.WebSocketHandler):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.cells = {}

    def check_origin(self, origin):
        # Override to enable support for allowing all cross-origin traffic
        return True

    def on_message(self, message):
        data = json.loads(message)
        code = data.get('code', 'No code provided')
        model = data.get('model', 'gpt-3.5-turbo')
        temp = data.get('temp', 1)
        cell_id = data.get("cellId", None)
        openai_api_key = data.get("openai_api_key", None)

        memory = self.cells.get(cell_id)
        if not memory:
            memory = ConversationBufferWindowMemory(k=3, memory_key="memory", return_messages=True)
            self.cells[cell_id] = memory

        llm = ChatOpenAI(openai_api_key=openai_api_key, model=model, temperature=temp, streaming=True, callbacks=[DefaultCallbackHandler(self.write_message)])
        
        prompt_template = PromptTemplate(input_variables=["memory", "code"], template=refactor_template)
        chain = LLMChain(
            llm=llm,
            prompt=prompt_template,
            verbose=True,
            memory=memory
        )
        chain({"code": code})


class DebugWebSocketHandler(tornado.websocket.WebSocketHandler):

    def check_origin(self, origin):
        # Override to enable support for allowing all cross-origin traffic
        return True

    def on_message(self, message):
        data = json.loads(message)
        code = data.get('code', 'No code provided')
        output = data.get('output', 'No output provided')
        error = data.get('error', 'No error provided')
        model = data.get('model', 'gpt-3.5-turbo')
        temp = data.get('temp', 1)
        openai_api_key = data.get("openai_api_key", None)

        llm = ChatOpenAI(openai_api_key=openai_api_key, model=model, temperature=temp, streaming=True, callbacks=[DefaultCallbackHandler(self.write_message)])
        
        debug_prompt_template = PromptTemplate(input_variables=["code", "output", "error"], template=debug_template)
        debug_chain = LLMChain(
            llm=llm,
            prompt=debug_prompt_template,
            verbose=True,
            output_key="refactored"
        )

        debug_explain_prompt_template = PromptTemplate(input_variables=["code", "output", "error", "refactored"], template=debug_explain_template)
        debug_explain_chain = LLMChain(
            llm=llm,
            prompt=debug_explain_prompt_template,
            verbose=True,
            output_key="explanation"
        )

        overall_chain = SequentialChain(
            chains=[debug_chain, debug_explain_chain],
            input_variables=["code", "output", "error"],
            # Here we return multiple variables
            output_variables=["refactored", "explanation"],
            verbose=True
        )

        overall_chain({"code": code, "output": output, "error": error})


class ExplainWebSocketHandler(tornado.websocket.WebSocketHandler):

    def check_origin(self, origin):
        # Override to enable support for allowing all cross-origin traffic
        return True

    def on_message(self, message):
        data = json.loads(message)
        code = data.get('code', 'No code provided')
        model = data.get('model', 'gpt-3.5-turbo')
        temp = data.get('temp', 1)
        openai_api_key = data.get("openai_api_key", None)

        llm = ChatOpenAI(openai_api_key=openai_api_key, model=model, temperature=temp, streaming=True, callbacks=[DefaultCallbackHandler(self.write_message)])
        
        prompt_template = PromptTemplate(input_variables=["code"], template=explain_template)
        chain = LLMChain(
            llm=llm,
            prompt=prompt_template,
            verbose=True
        )
        chain({"code": code})


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

