"""
Audit log service
"""
import logging
from typing import Optional, Dict, Any
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog

logger = logging.getLogger(__name__)


class AuditService:
    """Audit logging service"""

    async def log_action(
        self,
        db_session: AsyncSession,
        actor: str,
        action: str,
        target_type: Optional[str] = None,
        target_id: Optional[str] = None,
        message: Optional[str] = None,
        ip: Optional[str] = None
    ) -> None:
        try:
            log = AuditLog(
                actor=actor,
                action=action,
                target_type=target_type,
                target_id=target_id,
                message=message,
                ip=ip
            )
            db_session.add(log)
            await db_session.commit()
        except Exception as e:
            await db_session.rollback()
            logger.error(f"Failed to write audit log: {e}")

    async def get_logs(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 50,
        actor: Optional[str] = None,
        action: Optional[str] = None,
        target_type: Optional[str] = None
    ) -> Dict[str, Any]:
        try:
            stmt = select(AuditLog)
            filters = []
            if actor:
                filters.append(AuditLog.actor.ilike(f"%{actor}%"))
            if action:
                filters.append(AuditLog.action.ilike(f"%{action}%"))
            if target_type:
                filters.append(AuditLog.target_type == target_type)
            if filters:
                stmt = stmt.where(and_(*filters))

            count_stmt = select(func.count()).select_from(stmt.subquery())
            count_result = await db_session.execute(count_stmt)
            total = count_result.scalar() or 0

            import math
            total_pages = math.ceil(total / per_page) if total > 0 else 1
            if page < 1:
                page = 1
            if page > total_pages and total_pages > 0:
                page = total_pages
            offset = (page - 1) * per_page

            stmt = stmt.order_by(AuditLog.created_at.desc()).limit(per_page).offset(offset)
            result = await db_session.execute(stmt)
            logs = result.scalars().all()

            log_list = []
            for log in logs:
                log_list.append({
                    "id": log.id,
                    "actor": log.actor,
                    "action": log.action,
                    "target_type": log.target_type,
                    "target_id": log.target_id,
                    "message": log.message,
                    "ip": log.ip,
                    "created_at": log.created_at.isoformat() if log.created_at else None
                })

            return {
                "success": True,
                "logs": log_list,
                "total": total,
                "total_pages": total_pages,
                "current_page": page,
                "error": None
            }
        except Exception as e:
            logger.error(f"Failed to get audit logs: {e}")
            return {
                "success": False,
                "logs": [],
                "total": 0,
                "error": str(e)
            }


audit_service = AuditService()
