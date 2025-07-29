import os
from dotenv import load_dotenv

from langchain_community.vectorstores import FAISS
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_openai import ChatOpenAI
from langchain.memory import ConversationBufferMemory
from langchain.chains import ConversationalRetrievalChain
from langchain.prompts import ChatPromptTemplate

import openai

# Load environment variables
load_dotenv()

# Set up OpenRouter configuration
api_key = os.getenv("OPENROUTER_API_KEY")
if not api_key:
    raise ValueError("OPENROUTER_API_KEY not found in environment.")

openai.api_key = api_key
openai.api_base = "https://openrouter.ai/api/v1"
os.environ["OPENAI_API_KEY"] = api_key
os.environ["OPENAI_API_BASE"] = "https://openrouter.ai/api/v1"
os.environ["HTTP_REFERER"] = "https://yourdomain.com"
os.environ["X_TITLE"] = "KimiChatBot"

# Load FAISS vectorstore
embedder = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
vectorstore = FAISS.load_local("faiss_store", embedder, allow_dangerous_deserialization=True)

# Initialize Chat Model
llm = ChatOpenAI(model="tngtech/deepseek-r1t2-chimera:free")

# Prompt Template (includes memory variable)
prompt = ChatPromptTemplate.from_messages([
    ("system", """You are Kimi, a helpful and thoughtful assistant. 
Keep your responses clear, concise, and professional.
Do not summarize or comment on documents unless explicitly asked. 
Avoid excessive emojis or overly casual tone. 
Maintain proper spacing and indentation.

Context:
{context}"""),
    ("human", "{question}\n\nPrevious chat: {chat_history}")
])
# Memory
memory = ConversationBufferMemory(
    memory_key="chat_history",
    return_messages=True,
    input_key="question"
)

# RetrievalQA Chain with memory
chain = ConversationalRetrievalChain.from_llm(
    llm=llm,
    retriever=vectorstore.as_retriever(search_kwargs={"k": 3}),
    memory=memory,
    combine_docs_chain_kwargs={"prompt": prompt}
)

if __name__ == "__main__":
    print("\U0001F9E0 Kimi Chatbot")
    print("Type 'exit' to quit.\n")

    while True:
        query = input("You: ")
        if query.lower() == "exit":
            print("\U0001F44B Goodbye!")
            break
        try:
            response = chain.invoke({"question": query})
            print(f"Kimi: {response['answer']}\n")
        except Exception as e:
            print(f"[Error] {e}\n")
