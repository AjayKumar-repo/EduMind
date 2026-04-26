import os
import logging
from dotenv import load_dotenv
from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_openai import ChatOpenAI
from langchain.memory import ConversationBufferMemory
from langchain.chains import ConversationalRetrievalChain
from langchain.schema import Document
from langchain.prompts import ChatPromptTemplate
from langchain.schema import BaseRetriever, Document
from typing import List, Optional
import asyncio

# Import paths from ingest.py
from scripts.ingest import PDF_DIRECTORY, CHROMA_STORE_PATH

logger = logging.getLogger(__name__)
load_dotenv()

# Load API key
api_key = os.getenv("OPENROUTER_API_KEY")
if not api_key:
    raise ValueError("OPENROUTER_API_KEY not found in environment.")

os.environ["OPENAI_API_KEY"] = api_key
os.environ["OPENAI_API_BASE"] = "https://openrouter.ai/api/v1"

# Embeddings
embedder = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

# Global Chroma store
global_vectorstore = None

def initialize_vectorstore():
    """Load Chroma vector store from disk."""
    global global_vectorstore
    try:
        if os.path.exists(CHROMA_STORE_PATH):
            logger.info(f"Loading Chroma vector store from {CHROMA_STORE_PATH}...")
            global_vectorstore = Chroma(
                persist_directory=CHROMA_STORE_PATH,
                embedding_function=embedder
            )
            logger.info("Chroma vector store loaded successfully.")
        else:
            logger.warning("No Chroma store found, creating minimal store...")
            global_vectorstore = Chroma.from_texts(
                ["initial setup text."],
                embedding=embedder,
                persist_directory=CHROMA_STORE_PATH
            )
    except Exception as e:
        logger.error(f"Failed to load Chroma store: {e}")
        global_vectorstore = Chroma.from_texts(
            ["initial setup text."],
            embedding=embedder,
            persist_directory=CHROMA_STORE_PATH
        )

def update_vectorstore(new_vectorstore: Chroma):
    """Update the in-memory Chroma vector store."""
    global global_vectorstore
    global_vectorstore = new_vectorstore
    logger.info("Global Chroma vector store updated.")

# Chat model
llm = ChatOpenAI(model="mistralai/mistral-7b-instruct-v0.1")

# Prompt template
prompt = ChatPromptTemplate.from_messages([
    ("system", """You are Kimi, a helpful and thoughtful assistant.
Use your general knowledge to answer questions, but prioritize provided context.

Context:
{context}"""),
    ("human", "{question}\n\nPrevious chat: {chat_history}")
])

# Memory
memory = ConversationBufferMemory(
    memory_key="chat_history",
    return_messages=True,
    input_key="question",
    max_token_limit=500
)

async def get_retriever_with_filter(active_documents: Optional[List[str]] = None) -> BaseRetriever:
    """Return a Chroma retriever, optionally filtered by document source."""
    if global_vectorstore is None:
        logger.warning("Global vector store not initialized. Using minimal retriever.")
        dummy_store = Chroma.from_texts(["initial setup text."], embedding=embedder)
        return dummy_store.as_retriever(search_kwargs={"k": 3})

    if active_documents:
        logger.info(f"Filtering retriever by documents: {active_documents}")
        return global_vectorstore.as_retriever(search_kwargs={"k": 3, "filter": {"source": {"$in": active_documents}}})
    return global_vectorstore.as_retriever(search_kwargs={"k": 3})

# Build chain
from langchain.schema import Document

class EmptyRetriever(BaseRetriever):
    async def _aget_relevant_documents(self, query: str):
        return [Document(page_content="No context available yet.")]
    def _get_relevant_documents(self, query: str):
        return [Document(page_content="No context available yet.")]

initialize_vectorstore()

chain = ConversationalRetrievalChain.from_llm(
    llm=llm,
    retriever=(global_vectorstore.as_retriever(search_kwargs={"k": 3}) if global_vectorstore else EmptyRetriever()),
    memory=memory,
    combine_docs_chain_kwargs={"prompt": prompt}
)
