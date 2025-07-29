import os
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS

# ───────────────────────────────────────────────────────────────────────────────
# 📄 Load PDF (Update filename if different)
# ───────────────────────────────────────────────────────────────────────────────
pdf_path = "data/project_gen_2 (3).pdf"  # Change this if needed

if not os.path.exists(pdf_path):
    raise FileNotFoundError(f"PDF file not found at {pdf_path}")

loader = PyPDFLoader(pdf_path)
documents = loader.load()

# ───────────────────────────────────────────────────────────────────────────────
# ✂️ Split into Chunks
# ───────────────────────────────────────────────────────────────────────────────
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50,
    separators=["\n\n", "\n", " ", ""],
)

chunks = text_splitter.split_documents(documents)

# ───────────────────────────────────────────────────────────────────────────────
# 🤖 Embeddings and FAISS Index
# ───────────────────────────────────────────────────────────────────────────────
embedder = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
vectorstore = FAISS.from_documents(chunks, embedding=embedder)

# 🧠 Save to disk
vectorstore.save_local("faiss_store")

print("✅ FAISS index created and saved successfully.")
