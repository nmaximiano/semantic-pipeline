import os
from openai import AsyncOpenAI
from agent.config import AGENT_MODEL, AGENT_TEMPERATURE, OPENROUTER_BASE_URL


_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            api_key=os.getenv("OPENROUTER_API_KEY"),
            base_url=OPENROUTER_BASE_URL,
        )
    return _client


async def tool_completion(messages: list[dict], tools: list[dict],
                          model: str = AGENT_MODEL,
                          temperature: float = AGENT_TEMPERATURE):
    """Chat completion with tool definitions. Returns the full response object."""
    client = _get_client()
    resp = await client.chat.completions.create(
        model=model,
        messages=messages,
        tools=tools,
        temperature=temperature,
        extra_body={"provider": {"sort": "latency"}},
    )
    return resp


async def tool_completion_stream(messages: list[dict], tools: list[dict],
                                 model: str = AGENT_MODEL,
                                 temperature: float = AGENT_TEMPERATURE):
    """Streaming chat completion. Returns an async iterator of ChatCompletionChunk."""
    client = _get_client()
    return await client.chat.completions.create(
        model=model,
        messages=messages,
        tools=tools,
        temperature=temperature,
        stream=True,
        stream_options={"include_usage": True},
        extra_body={"provider": {"sort": "latency"}},
    )
