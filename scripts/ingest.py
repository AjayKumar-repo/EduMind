import asyncio
import logging
import os
from functools import lru_cache

from langchain_chroma import Chroma
from langchain_community.document_loaders import PyPDFLoader
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

logger = logging.getLogger(__name__)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PDF_DIRECTORY = os.path.join(SCRIPT_DIR, "data")
CHROMA_STORE_PATH = os.path.join(SCRIPT_DIR, "chroma_store")  # Persistent Chroma storage
COLLECTION_NAME = "edumind_documents"

# Serialises rebuilds so two uploads at once can't interleave.
_rebuild_lock = asyncio.Lock()


@lru_cache(maxsize=1)
def get_embedder() -> HuggingFaceEmbeddings:
    """Load the embedding model once and share it across the app."""
    return HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")


_vectorstore = None


def get_vectorstore() -> Chroma:
    """Return the single shared Chroma store, opening it on first use.

    Chat and re-indexing use this same object, so after a rebuild chat sees
    new documents immediately without a restart.
    """
    global _vectorstore
    if _vectorstore is None:
        _vectorstore = Chroma(
            collection_name=COLLECTION_NAME,
            persist_directory=CHROMA_STORE_PATH,
            embedding_function=get_embedder(),
        )
    return _vectorstore


def _build_vectorstore_sync() -> Chroma:
    os.makedirs(PDF_DIRECTORY, exist_ok=True)

    all_documents = []
    for filename in sorted(os.listdir(PDF_DIRECTORY)):
        if not filename.lower().endswith(".pdf"):
            continue
        pdf_path = os.path.join(PDF_DIRECTORY, filename)
        logger.info(f"Loading document: {pdf_path}")
        try:
            documents = PyPDFLoader(pdf_path).load()
        except Exception as e:
            logger.error(f"Skipping unreadable PDF '{filename}': {e}")
            continue
        for doc in documents:
            doc.metadata["source"] = filename
        all_documents.extend(documents)

    # Start from an empty collection each time so re-indexing never duplicates chunks.
    vectorstore = get_vectorstore()
    vectorstore.reset_collection()

    if not all_documents:
        logger.warning("No PDF documents found. The knowledge base is empty.")
        return vectorstore

    splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
    chunks = splitter.split_documents(all_documents)
    vectorstore.add_documents(chunks)
    logger.info(f"Chroma vector store rebuilt with {len(chunks)} chunks from {len({d.metadata['source'] for d in all_documents})} document(s).")
    return vectorstore


async def rebuild_vectorstore() -> Chroma:
    """Re-index every PDF in PDF_DIRECTORY without blocking the event loop."""
    async with _rebuild_lock:
        logger.info(f"Rebuilding Chroma vector store from {PDF_DIRECTORY}...")
        return await asyncio.to_thread(_build_vectorstore_sync)
