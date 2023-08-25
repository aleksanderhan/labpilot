import json
from langchain.callbacks.base import BaseCallbackHandler
from langchain.schema import LLMResult, AgentAction
from typing import List, Dict, Any, Union

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