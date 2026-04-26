import math
import time
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any

router = APIRouter()

# --- Pydantic Models ---
# These models define the expected structure for request bodies.
class ScoreDetail(BaseModel):
    score: int
    total: int

class PerformanceResult(BaseModel):
    testId: str
    scores: Dict[str, ScoreDetail]
    timestamp: float

class KnowledgePointsRequest(BaseModel):
    history: List[PerformanceResult]

# --- 1. Learner Type Badge (Placeholder) ---
@router.get("/learner-style")
async def get_learner_style():
    """
    In a real-world application with user accounts, this endpoint would fetch
    the user's saved learning style from a database. For this project, the
    frontend determines the style via assessment and manages it. This endpoint
    serves as a structural placeholder for a complete modular system.
    """
    return {"learning_style": "Visual", "description": "You learn best through seeing information."}

# --- 2. Knowledge Points System ---
@router.post("/knowledge-points")
async def calculate_knowledge_points(req: KnowledgePointsRequest):
    """
    Calculates the user's knowledge points, tier, and progress based on
    their entire test history.
    """
    total_correct = 0
    total_questions = 0
    
    # Scoring Logic: 10 points per correct answer, 100 points per completed test.
    for result in req.history:
        total_questions_in_test = 0
        for category, data in result.scores.items():
            total_correct += data.score
            total_questions_in_test += data.total
        total_questions += total_questions_in_test
    
    points = (total_correct * 10) + (len(req.history) * 100)
    
    # Tier progression logic
    if points <= 1500:
        tier = "Beginner"
        next_tier_points = 1501
        current_tier_min = 0
    elif points <= 4000:
        tier = "Intermediate"
        next_tier_points = 4001
        current_tier_min = 1501
    else:
        tier = "Expert"
        next_tier_points = float('inf')  # Represents the highest tier
        current_tier_min = 4001
        
    return {
        "points": points,
        "tier": tier,
        "nextTierPoints": next_tier_points,
        "currentTierMin": current_tier_min,
        "totalCorrect": total_correct,
        "totalQuestions": total_questions,
        "testsCompleted": len(req.history)
    }

# --- 3. Ebbinghaus Forgetting Curve ---
@router.post("/forgetting-curve-data")
async def get_forgetting_curve_data(req: KnowledgePointsRequest):
    """
    Generates data points for the Ebbinghaus Forgetting Curve based on the
    user's most recent test performance.
    """
    if not req.history:
        return {"curveData": [], "topic": "No tests taken yet"}

    # Use the most recent test as the starting point for the curve
    latest_test = max(req.history, key=lambda x: x.timestamp)
    
    total_score = sum(cat.score for cat in latest_test.scores.values())
    total_qs = sum(cat.total for cat in latest_test.scores.values())
    
    initial_retention = (total_score / total_qs) * 100 if total_qs > 0 else 0
    
    # Calculate time passed since the test was taken (in days)
    time_since_test_ms = (time.time() * 1000) - latest_test.timestamp
    time_since_test_days = time_since_test_ms / (1000 * 60 * 60 * 24)

    # Simplified Ebbinghaus formula: R(t) = R0 * e^(-t/S)
    # R0 = initial retention from the test score.
    # S = strength of memory (a higher value means slower forgetting).
    # t = time in days.
    # UPDATED FORMULA: S now ranges from 5 to 15, making memory stronger for higher scores.
    S = 5 + (initial_retention / 10) 
    
    curve_points = []
    # Generate predicted retention for the next 30 days
    for t_days in range(31):
        retention = initial_retention * math.exp(-t_days / S)
        curve_points.append({"x": t_days, "y": round(retention, 2)})

    # Calculate the user's current estimated retention
    current_retention = initial_retention * math.exp(-time_since_test_days / S)

    return {
        "topic": f"Knowledge from Test on {time.strftime('%b %d, %Y', time.localtime(latest_test.timestamp / 1000))}",
        "curveData": curve_points,
        "lastReviewedTimestamp": latest_test.timestamp,
        "currentRetention": round(current_retention, 2)
    }