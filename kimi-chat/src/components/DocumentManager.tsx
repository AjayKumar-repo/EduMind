import React, { useState, useEffect } from "react";

function DocumentManager() {
  const [documents, setDocuments] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    fetch("http://127.0.0.1:8000/documents")
      .then((res) => res.json())
      .then((data) => setDocuments(data.documents || []));
  }, []);

  const uploadFile = async () => {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);

    await fetch("http://127.0.0.1:8000/upload-document/", {
      method: "POST",
      body: formData,
    });

    fetch("http://127.0.0.1:8000/documents")
      .then((res) => res.json())
      .then((data) => setDocuments(data.documents || []));
  };

  return (
    <div>
      <h1>📂 Document Manager</h1>
      <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      <button onClick={uploadFile}>Upload</button>
      <ul>
        {documents.map((doc) => (
          <li key={doc}>{doc}</li>
        ))}
      </ul>
    </div>
  );
}

export default DocumentManager;
