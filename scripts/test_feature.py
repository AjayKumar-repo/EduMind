import json
import uuid
import os
import requests
from typing import Dict, List
import concurrent.futures
import random

# --- Configuration ---
api_key = os.environ.get("OPENROUTER_API_KEY")
if not api_key:
    print("Warning: OPENROUTER_API_KEY environment variable not found. Test generation will fail.")

def generate_questions_from_chunk(chunk: str, category: str, num_questions: int) -> List[Dict]:
    """
    Generates a specified number of questions for a specific category from a single document chunk.
    """
    if not api_key:
        print("Error: Cannot generate questions because OPENROUTER_API_KEY is not set.")
        return []

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    prompt_text = f"""
    You are an expert test creator. Based ONLY on the following document text, generate a JSON object.
    Your task is to create {num_questions} questions for the category: "{category}".

    The JSON object must contain a single key "questions", which is a list of exactly {num_questions} question objects.

    Each question object in the list must have the following keys:
    - "category": This must be exactly "{category}".
    - "questionText": A string containing the question based on the document.
    - "options": A list of exactly four unique strings representing the multiple-choice options. The "options" list MUST contain exactly 4 items.
    - "correctAnswer": A string that exactly matches one of the four options.

    Do not generate questions for any other category. Your entire output must be only the raw JSON object itself.

    Document Text Chunk:
    ---
    {chunk}
    ---
    """
    
    data = {
        "model": "mistralai/mixtral-8x7b-instruct",
        "response_format": {"type": "json_object"},
        "messages": [{"role": "user", "content": prompt_text}]
    }

    try:
        response = requests.post(url, headers=headers, data=json.dumps(data), timeout=90)
        response.raise_for_status() 
        
        response_json = response.json()
        raw_text_content = response_json['choices'][0]['message']['content']
        
        json_start_index = raw_text_content.find('{')
        json_end_index = raw_text_content.rfind('}')
        if json_start_index != -1 and json_end_index != -1:
            json_string = raw_text_content[json_start_index : json_end_index + 1]
            test_content = json.loads(json_string)
        else:
            raise ValueError("No valid JSON object found in AI response.")
        
        if "questions" not in test_content or not isinstance(test_content["questions"], list):
            raise ValueError("Generated content is not in the expected format.")
            
        return test_content["questions"]

    except requests.exceptions.RequestException as e:
        print(f"A request error occurred for a chunk in category {category}: {e}")
        return []
    except (json.JSONDecodeError, ValueError) as e:
        print(f"JSON processing error for a chunk in category {category}: {e}")
        return []
    except Exception as e:
        print(f"An unexpected error occurred for a chunk in category {category}: {e}")
        return []

def create_mcq_test(document_chunks: List[str]) -> Dict:
    """
    Generates a 16-question test (exactly 4 per category) from document chunks.
    It will make multiple attempts if necessary to meet the question count.
    """
    categories = ["Cognitive Memory", "Logical Reasoning", "Critical Thinking", "Creative Application"]
    questions_per_category = 4
    total_questions_needed = 16
    
    if not document_chunks:
        return {"testId": None, "questions": []}

    final_questions = []
    seen_question_texts = set()

    # Process each category sequentially to ensure we get 4 questions for each.
    for category in categories:
        category_questions = []
        # Create a large, shuffled pool of chunks to draw from, preventing infinite loops.
        chunk_pool = random.sample(document_chunks * 5, k=len(document_chunks) * 5)
        
        for chunk in chunk_pool:
            # If we already have enough questions for this category, move to the next.
            if len(category_questions) >= questions_per_category:
                break
            
            # Request the number of questions we still need for this category.
            num_needed = questions_per_category - len(category_questions)
            
            try:
                generated_qs = generate_questions_from_chunk(chunk, category, num_needed)
                
                for q in generated_qs:
                    # Perform strict validation on each generated question.
                    is_valid = (
                        q.get("questionText") and
                        q.get("category") == category and
                        isinstance(q.get("options"), list) and
                        len(q["options"]) == 4 and
                        q.get("correctAnswer") in q["options"]
                    )
                    # Ensure the question is unique across the entire test.
                    is_unique = q["questionText"] not in seen_question_texts

                    if is_valid and is_unique:
                        category_questions.append(q)
                        seen_question_texts.add(q["questionText"])
                        # If we have enough for this category, stop processing this chunk's results.
                        if len(category_questions) >= questions_per_category:
                            break
            except Exception as e:
                print(f"An error occurred during question generation for {category}: {e}")

        final_questions.extend(category_questions)

    # Final check on the number of questions generated.
    if len(final_questions) < total_questions_needed:
        print(f"Warning: Could only generate {len(final_questions)}/{total_questions_needed} valid questions. The test will be shorter.")

    # Shuffle the final list to mix categories and assign IDs.
    random.shuffle(final_questions)
    for i, question in enumerate(final_questions):
        question['id'] = i + 1
        
    final_test = {
        "testId": str(uuid.uuid4()),
        "questions": final_questions
    }
    
    print("--- Successfully Generated Test Content ---")
    print(f"Generated {len(final_test['questions'])} questions, with { {cat: len([q for q in final_questions if q['category'] == cat]) for cat in categories} } distribution.")
    print("-----------------------------------------")
        
    return final_test
