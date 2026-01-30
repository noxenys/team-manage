"""
质保服务
处理用户质保查询和验证
"""
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import RedemptionCode, RedemptionRecord, Team
from app.utils.time_utils import get_now

logger = logging.getLogger(__name__)

# 全局频率限制字典: {(type, key): last_time}
# type: 'email' or 'code'
_query_rate_limit = {}


class WarrantyService:
    """质保服务类"""

    def __init__(self):
        """初始化质保服务"""
        from app.services.team import TeamService
        self.team_service = TeamService()

    async def check_warranty_status(
        self,
        db_session: AsyncSession,
        email: Optional[str] = None,
        code: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        检查用户质保状态

        Args:
            db_session: 数据库会话
            email: 用户邮箱
            code: 兑换码

        Returns:
            结果字典,包含 success, has_warranty, warranty_valid, warranty_expires_at, 
            banned_teams, can_reuse, original_code, error
        """
        try:
            if not email and not code:
                return {
                    "success": False,
                    "error": "必须提供邮箱或兑换码"
                }

            # 0. 频率限制 (每个邮箱或每个码 30 秒只能查一次)
            now = datetime.now()
            limit_key = ("email", email) if email else ("code", code)
            last_time = _query_rate_limit.get(limit_key)
            if last_time and (now - last_time).total_seconds() < 30:
                wait_time = int(30 - (now - last_time).total_seconds())
                return {
                    "success": False,
                    "error": f"查询太频繁,请 {wait_time} 秒后再试"
                }
            _query_rate_limit[limit_key] = now

            # 1. 根据邮箱或兑换码查找兑换记录
            redemption_code_obj = None
            redemption_records = []

            if code:
                # 通过兑换码查找
                stmt = select(RedemptionCode).where(RedemptionCode.code == code)
                result = await db_session.execute(stmt)
                redemption_code_obj = result.scalar_one_or_none()

                if not redemption_code_obj:
                    return {
                        "success": True,
                        "has_warranty": False,
                        "warranty_valid": False,
                        "warranty_expires_at": None,
                        "banned_teams": [],
                        "can_reuse": False,
                        "original_code": None,
                        "error": None,
                        "message": "兑换码不存在"
                    }

                # 查找该兑换码的所有使用记录
                stmt = select(RedemptionRecord).where(RedemptionRecord.code == code)
                result = await db_session.execute(stmt)
                redemption_records = result.scalars().all()

            elif email:
                # 通过邮箱查找所有兑换记录
                stmt = select(RedemptionRecord).where(RedemptionRecord.email == email)
                result = await db_session.execute(stmt)
                redemption_records = result.scalars().all()

                # 查找是否有质保兑换码
                for record in redemption_records:
                    stmt = select(RedemptionCode).where(RedemptionCode.code == record.code)
                    result = await db_session.execute(stmt)
                    code_obj = result.scalar_one_or_none()
                    if code_obj and code_obj.has_warranty:
                        redemption_code_obj = code_obj
                        break

            if not redemption_code_obj:
                return {
                    "success": True,
                    "has_warranty": False,
                    "warranty_valid": False,
                    "warranty_expires_at": None,
                    "banned_teams": [],
                    "can_reuse": False,
                    "original_code": None,
                    "error": None,
                    "message": "未找到质保兑换码"
                }

            # 2. 检查是否为质保兑换码
            if not redemption_code_obj.has_warranty:
                return {
                    "success": True,
                    "has_warranty": False,
                    "warranty_valid": False,
                    "warranty_expires_at": None,
                    "banned_teams": [],
                    "can_reuse": False,
                    "original_code": redemption_code_obj.code,
                    "error": None,
                    "message": "该兑换码不是质保兑换码"
                }

            # 3. 检查质保是否有效
            warranty_valid = True
            if redemption_code_obj.warranty_expires_at:
                if redemption_code_obj.warranty_expires_at < get_now():
                    warranty_valid = False

            # 4. 查找被封的 Team
            banned_teams = []
            for record in redemption_records:
                stmt = select(Team).where(Team.id == record.team_id)
                result = await db_session.execute(stmt)
                team = result.scalar_one_or_none()
                if team:
                    # 如果不是已封号状态，则进行一次实时测试
                    if team.status != "banned":
                        logger.info(f"质保查询: 正在实时测试 Team {team.id} ({team.team_name}) 的状态")
                        await self.team_service.sync_team_info(team.id, db_session)
                        # sync_team_info 会更新 team 对象的属性并提交

                    if team.status == "banned":
                        banned_teams.append({
                            "team_id": team.id,
                            "team_name": team.team_name,
                            "email": team.email,
                            "banned_at": team.last_sync.isoformat() if team.last_sync else None
                        })

            # 5. 判断是否可以重复使用
            can_reuse = warranty_valid and len(banned_teams) > 0

            return {
                "success": True,
                "has_warranty": True,
                "warranty_valid": warranty_valid,
                "warranty_expires_at": redemption_code_obj.warranty_expires_at.isoformat() if redemption_code_obj.warranty_expires_at else None,
                "banned_teams": banned_teams,
                "can_reuse": can_reuse,
                "original_code": redemption_code_obj.code,
                "error": None,
                "message": "查询成功"
            }

        except Exception as e:
            logger.error(f"检查质保状态失败: {e}")
            return {
                "success": False,
                "error": f"检查质保状态失败: {str(e)}"
            }

    async def validate_warranty_reuse(
        self,
        db_session: AsyncSession,
        code: str,
        email: str
    ) -> Dict[str, Any]:
        """
        验证质保码是否可重复使用

        Args:
            db_session: 数据库会话
            code: 兑换码
            email: 用户邮箱

        Returns:
            结果字典,包含 success, can_reuse, reason, error
        """
        try:
            # 1. 查询兑换码
            stmt = select(RedemptionCode).where(RedemptionCode.code == code)
            result = await db_session.execute(stmt)
            redemption_code = result.scalar_one_or_none()

            if not redemption_code:
                return {
                    "success": True,
                    "can_reuse": False,
                    "reason": "兑换码不存在",
                    "error": None
                }

            # 2. 检查是否为质保码
            if not redemption_code.has_warranty:
                return {
                    "success": True,
                    "can_reuse": False,
                    "reason": "该兑换码不是质保兑换码",
                    "error": None
                }

            # 3. 检查质保期是否有效
            if redemption_code.warranty_expires_at:
                if redemption_code.warranty_expires_at < get_now():
                    return {
                        "success": True,
                        "can_reuse": False,
                        "reason": "质保已过期",
                        "error": None
                    }

            # 4. 查找该用户使用该兑换码的所有记录
            stmt = select(RedemptionRecord).where(
                and_(
                    RedemptionRecord.code == code,
                    RedemptionRecord.email == email
                )
            ).order_by(RedemptionRecord.redeemed_at.desc())
            result = await db_session.execute(stmt)
            records = result.scalars().all()
            
            if not records:
                # 首次使用，允许
                return {
                    "success": True,
                    "can_reuse": True,
                    "reason": "首次使用",
                    "error": None
                }

            # 5. 检查用户当前是否已在有效的 Team 中
            # 逻辑：如果最近一次加入的 Team 仍然有效（active/full 且未过期），则不允许重复使用
            for record in records:
                stmt = select(Team).where(Team.id == record.team_id)
                result = await db_session.execute(stmt)
                team = result.scalar_one_or_none()
                
                if team:
                    # 如果有任何一个关联 Team 还是 active/full 状态，且未过期
                    is_expired = team.expires_at and team.expires_at < get_now()
                    if team.status in ["active", "full"] and not is_expired:
                        return {
                            "success": True,
                            "can_reuse": False,
                            "reason": f"您已在有效 Team 中 ({team.team_name or team.id})，不可重复兑换",
                            "error": None
                        }

            # 6. 检查是否有过被封的记录
            has_banned_team = False
            for record in records:
                stmt = select(Team).where(Team.id == record.team_id)
                result = await db_session.execute(stmt)
                team = result.scalar_one_or_none()
                if team and team.status in ["banned", "error"]:
                    has_banned_team = True
                    break

            if has_banned_team:
                return {
                    "success": True,
                    "can_reuse": True,
                    "reason": "之前加入的 Team 已失效，可使用质保重复兑换",
                    "error": None
                }
            else:
                return {
                    "success": True,
                    "can_reuse": False,
                    "reason": "未找到被封或异常记录，且质保不支持正常过期的重复兑换",
                    "error": None
                }

        except Exception as e:
            logger.error(f"验证质保码重复使用失败: {e}")
            return {
                "success": False,
                "can_reuse": False,
                "reason": None,
                "error": f"验证失败: {str(e)}"
            }


# 创建全局质保服务实例
warranty_service = WarrantyService()
