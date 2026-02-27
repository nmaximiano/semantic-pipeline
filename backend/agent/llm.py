import os
from openai import AsyncOpenAI
from agent.config import AGENT_MODEL, REPLAN_MODEL, AGENT_TEMPERATURE, OPENROUTER_BASE_URL


_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            api_key=os.getenv("OPENROUTER_API_KEY"),
            base_url=OPENROUTER_BASE_URL,
        )
    return _client


async def chat_completion(messages: list[dict], model: str = AGENT_MODEL,
                          temperature: float = AGENT_TEMPERATURE) -> str:
    """Simple chat completion -> returns assistant content string."""
    client = _get_client()
    resp = await client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
        extra_body={"provider": {"sort": "latency"}},
    )
    return resp.choices[0].message.content or ""


async def plan_completion(messages: list[dict]) -> str:
    """Plan using the main model."""
    return await chat_completion(messages, model=AGENT_MODEL)


async def replan_completion(messages: list[dict]) -> str:
    """Replan using the cheaper model."""
    return await chat_completion(messages, model=REPLAN_MODEL)
