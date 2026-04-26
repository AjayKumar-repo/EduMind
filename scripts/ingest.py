import os
import logging
import asyncio
from functools import partial
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma

logger = logging.getLogger(__name__)

SCRIPT_DIR = os.path.dirname(__file__)
PDF_DIRECTORY = os.path.join(SCRIPT_DIR, "data")
CHROMA_STORE_PATH = os.path.join(SCRIPT_DIR, "chroma_store")  # Persistent Chroma storage

async def rebuild_vectorstore():
    logger.info(f"Starting async Chroma vector store rebuild from {PDF_DIRECTORY}...")
    loop = asyncio.get_running_loop()

    os.makedirs(PDF_DIRECTORY, exist_ok=True)

    all_documents = []
    files_in_dir = await loop.run_in_executor(None, os.listdir, PDF_DIRECTORY)

    for filename in files_in_dir:
        if filename.endswith(".pdf"):
            pdf_path = os.path.join(PDF_DIRECTORY, filename)
            logger.info(f"Loading document: {pdf_path}")
            loader = PyPDFLoader(pdf_path)
            documents = await loop.run_in_executor(None, loader.load)

            for doc in documents:
                doc.metadata["source"] = filename
            all_documents.extend(documents)

    if not all_documents:
        logger.warning("No PDF documents found. Creating minimal vector store.")
        embedder = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
        vs = Chroma.from_texts(
            ["initial setup text."],
            embedding=embedder,
            persist_directory=CHROMA_STORE_PATH
        )
        vs.persist()
        return vs

    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=500,
        chunk_overlap=50
    )
    chunks = await loop.run_in_executor(None, text_splitter.split_documents, all_documents)

    embedder = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

    vectorstore = Chroma.from_documents(
        documents=chunks,
        embedding=embedder,
        persist_directory=CHROMA_STORE_PATH
    )
    

    logger.info("✅ Chroma vector store built and persisted successfully.")
    return vectorstore
