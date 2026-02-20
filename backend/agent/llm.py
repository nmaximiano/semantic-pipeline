import os
from langchain_openai import ChatOpenAI
from agent.config import AGENT_MODEL, AGENT_TEMPERATURE, OPENROUTER_BASE_URL


def get_llm() -> ChatOpenAI:
    return ChatOpenAI(
        model=AGENT_MODEL,
        temperature=AGENT_TEMPERATURE,
        openai_api_key=os.getenv("OPENROUTER_API_KEY"),
        openai_api_base=OPENROUTER_BASE_URL,
    )
