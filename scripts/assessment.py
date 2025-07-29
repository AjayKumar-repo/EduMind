from fastapi import APIRouter
from pydantic import BaseModel
from typing import List
from collections import Counter
import logging

# Set up logger
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

router = APIRouter()

# Quiz question generator
def get_questions():
    return [
        {
            "id": 1,
            "question": "When learning something new, what do you prefer?",
            "options": [
                {"text": "Watching a video or diagram", "type": "pictorial"},
                {"text": "Doing a hands-on activity", "type": "kinesthetic"},
                {"text": "Listening to explanations or podcasts", "type": "vocal"},
                {"text": "Reading and memorizing notes", "type": "memorizer"}
            ]
        },
        {
            "id": 2,
            "question": "How do you recall information best?",
            "options": [
                {"text": "Visualizing the content", "type": "pictorial"},
                {"text": "Remembering how I did it", "type": "kinesthetic"},
                {"text": "Hearing the information in my head", "type": "vocal"},
                {"text": "Reciting facts I studied", "type": "memorizer"}
            ]
        },
        {
            "id": 3,
            "question": "When trying to solve a problem, what helps you the most?",
            "options": [
                {"text": "Drawing it out or making a diagram", "type": "pictorial"},
                {"text": "Physically acting it out or testing it", "type": "kinesthetic"},
                {"text": "Talking through it with someone", "type": "vocal"},
                {"text": "Writing down steps and facts", "type": "memorizer"}
            ]
        },
        {
            "id": 4,
            "question": "What do you do first when you get a new device or gadget?",
            "options": [
                {"text": "Look at the images or diagrams in the manual", "type": "pictorial"},
                {"text": "Start playing with it to figure it out", "type": "kinesthetic"},
                {"text": "Ask someone to explain how it works", "type": "vocal"},
                {"text": "Read the instructions line by line", "type": "memorizer"}
            ]
        },
        {
            "id": 5,
            "question": "During lectures or classes, what keeps you most engaged?",
            "options": [
                {"text": "Slides and illustrations", "type": "pictorial"},
                {"text": "Interactive activities", "type": "kinesthetic"},
                {"text": "Listening to the teacher", "type": "vocal"},
                {"text": "Taking detailed notes", "type": "memorizer"}
            ]
        },
        {
            "id": 6,
            "question": "What method helps you prepare best for a test?",
            "options": [
                {"text": "Using flashcards with visuals", "type": "pictorial"},
                {"text": "Re-doing homework or practice problems", "type": "kinesthetic"},
                {"text": "Explaining topics to others", "type": "vocal"},
                {"text": "Reading notes and rewriting key points", "type": "memorizer"}
            ]
        },
        {
            "id": 7,
            "question": "Which activity sounds most enjoyable for you?",
            "options": [
                {"text": "Creating a mind map or infographic", "type": "pictorial"},
                {"text": "Building something or crafting", "type": "kinesthetic"},
                {"text": "Recording a podcast or doing a speech", "type": "vocal"},
                {"text": "Solving a puzzle or quiz", "type": "memorizer"}
            ]
        },
        {
            "id": 8,
            "question": "How do you usually take in information while reading a textbook?",
            "options": [
                {"text": "Focus on the diagrams and images", "type": "pictorial"},
                {"text": "Take breaks to try out examples physically", "type": "kinesthetic"},
                {"text": "Read aloud or listen to audio versions", "type": "vocal"},
                {"text": "Highlight and memorize key lines", "type": "memorizer"}
            ]
        },
        {
            "id": 9,
            "question": "When you remember a past event, what stands out most?",
            "options": [
                {"text": "The images or visuals of the scene", "type": "pictorial"},
                {"text": "The actions or movements you did", "type": "kinesthetic"},
                {"text": "The conversations or sounds", "type": "vocal"},
                {"text": "The details and facts you recall", "type": "memorizer"}
            ]
        },
        {
            "id": 10,
            "question": "What’s your preferred way to give a presentation?",
            "options": [
                {"text": "Using charts, slides, and visuals", "type": "pictorial"},
                {"text": "Doing a demo or involving the audience", "type": "kinesthetic"},
                {"text": "Speaking clearly and using voice effectively", "type": "vocal"},
                {"text": "Sticking to a script or outline", "type": "memorizer"}
            ]
        }

        ]


class AnswerSubmission(BaseModel):
    answers: List[str]  # e.g., ["pictorial", "kinesthetic", "vocal"]

def evaluate_answers(answers):
    count = Counter(answers)
    logger.info(f"Answer counts: {count}")
    learner_type = count.most_common(1)[0][0]
    logger.info(f"Detected learner type: {learner_type}")
    return learner_type

@router.get("/assessment/questions")
def fetch_questions():
    logger.info("Questions requested")
    return {"questions": get_questions()}

@router.post("/assessment/evaluate")
def assess_learner(data: AnswerSubmission):
    logger.info(f"Answers received: {data.answers}")

    if not data.answers or len(data.answers) < 2:
        logger.warning("Not enough answers submitted.")
        return {"error": "Not enough answers submitted."}
    
    learner_type = evaluate_answers(data.answers)

    LEARNER_DESCRIPTIONS = {
        "pictorial": "You learn best by seeing. Visuals like videos, diagrams, and mind maps help you.",
        "kinesthetic": "You learn best by doing. Physical activities, labs, or practical demos are ideal.",
        "vocal": "You learn best by hearing. Listening to lectures, podcasts, or group discussions help you.",
        "memorizer": "You are best at memorizing. Repetition, notes, and structured review benefit you."
    }

    result = {
        "learning_style": learner_type,
        "description": LEARNER_DESCRIPTIONS.get(learner_type, "Unknown learner type")
    }

    logger.info(f"Assessment result: {result}")
    return result
