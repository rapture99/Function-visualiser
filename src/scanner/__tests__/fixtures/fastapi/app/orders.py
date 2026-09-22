from fastapi import APIRouter
router = APIRouter()

@router.get("/orders")
def list_orders():
    return []

@router.post("/orders")
def create_order():
    return {}
