// 用户兑换页面JavaScript

// HTML转义函数 - 防止XSS攻击
function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) {
        return '';
    }
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// 全局变量
let currentEmail = '';
let currentCode = '';
let availableTeams = [];
let selectedTeamId = null;

// Toast提示函数
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;

    let icon = 'info';
    if (type === 'success') icon = 'check-circle';
    if (type === 'error') icon = 'alert-circle';

    toast.innerHTML = `<i data-lucide="${icon}"></i><span>${message}</span>`;
    toast.className = `toast ${type} show`;

    if (window.lucide) {
        lucide.createIcons();
    }

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// 切换步骤
function showStep(stepNumber) {
    document.querySelectorAll('.step').forEach(step => {
        step.classList.remove('active');
    });
    document.getElementById(`step${stepNumber}`).classList.add('active');
}

// 返回步骤1
function backToStep1() {
    showStep(1);
    selectedTeamId = null;
    // 隐藏质保结果
    document.getElementById('warrantyResult').style.display = 'none';
    document.getElementById('step1').style.display = 'block';
}

// 步骤1: 验证兑换码并直接兑换
document.getElementById('verifyForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('email').value.trim();
    const code = document.getElementById('code').value.trim();
    const verifyBtn = document.getElementById('verifyBtn');

    // 验证
    if (!email || !code) {
        showToast('请填写完整信息', 'error');
        return;
    }

    // 保存到全局变量
    currentEmail = email;
    currentCode = code;

    // 禁用按钮
    verifyBtn.disabled = true;
    verifyBtn.textContent = '正在兑换...';

    // 直接调用兑换接口 (team_id = null 表示自动选择)
    await confirmRedeem(null);

    // 恢复按钮状态 (如果 confirmRedeem 失败并显示了错误也没关系，因为用户可以点返回重试)
    verifyBtn.disabled = false;
    verifyBtn.textContent = '验证兑换码';
});

// 渲染Team列表
function renderTeamsList() {
    const teamsList = document.getElementById('teamsList');
    teamsList.innerHTML = '';

    availableTeams.forEach(team => {
        const teamCard = document.createElement('div');
        teamCard.className = 'team-card';
        teamCard.onclick = () => selectTeam(team.id);

        const planBadge = team.subscription_plan === 'Plus' ? 'badge-plus' : 'badge-pro';

        teamCard.innerHTML = `
            <div class="team-name">${escapeHtml(team.team_name) || 'Team ' + team.id}</div>
            <div class="team-info">
                <div class="team-info-item">
                    <i data-lucide="users" style="width: 14px; height: 14px;"></i>
                    <span>${team.current_members}/${team.max_members} 成员</span>
                </div>
                <div class="team-info-item">
                    <span class="team-badge ${planBadge}">${escapeHtml(team.subscription_plan) || 'Plus'}</span>
                </div>
                ${team.expires_at ? `
                <div class="team-info-item">
                    <i data-lucide="calendar" style="width: 14px; height: 14px;"></i>
                    <span>到期: ${formatDate(team.expires_at)}</span>
                </div>
                ` : ''}
            </div>
        `;

        teamsList.appendChild(teamCard);
        if (window.lucide) lucide.createIcons();
    });
}

// 选择Team
function selectTeam(teamId) {
    selectedTeamId = teamId;

    // 更新UI
    document.querySelectorAll('.team-card').forEach(card => {
        card.classList.remove('selected');
    });
    event.currentTarget.classList.add('selected');

    // 立即确认兑换
    confirmRedeem(teamId);
}

// 自动选择Team
function autoSelectTeam() {
    if (availableTeams.length === 0) {
        showToast('没有可用的 Team', 'error');
        return;
    }

    // 自动选择第一个Team(后端会按过期时间排序)
    confirmRedeem(null);
}

// 确认兑换
async function confirmRedeem(teamId) {
    try {
        const response = await fetch('/redeem/confirm', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: currentEmail,
                code: currentCode,
                team_id: teamId
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            // 兑换成功
            showSuccessResult(data);
        } else {
            // 兑换失败
            // 处理 FastAPI 的 HTTPException (detail) 和自定义错误响应 (error)
            const errorMessage = data.detail || data.error || '兑换失败';
            showErrorResult(errorMessage);
        }
    } catch (error) {
        showErrorResult('网络错误,请稍后重试');
    }
}

// 显示成功结果
function showSuccessResult(data) {
    const resultContent = document.getElementById('resultContent');
    const teamInfo = data.team_info || {};

    resultContent.innerHTML = `
        <div class="result-success">
            <div class="result-icon"><i data-lucide="check-circle" style="width: 64px; height: 64px; color: var(--success);"></i></div>
            <div class="result-title">兑换成功!</div>
            <div class="result-message">${escapeHtml(data.message) || '您已成功加入 Team'}</div>

            <div class="result-details">
                <div class="result-detail-item">
                    <span class="result-detail-label">Team 名称</span>
                    <span class="result-detail-value">${escapeHtml(teamInfo.team_name) || '-'}</span>
                </div>
                <div class="result-detail-item">
                    <span class="result-detail-label">邮箱地址</span>
                    <span class="result-detail-value">${escapeHtml(currentEmail)}</span>
                </div>
                ${teamInfo.expires_at ? `
                <div class="result-detail-item">
                    <span class="result-detail-label">到期时间</span>
                    <span class="result-detail-value">${formatDate(teamInfo.expires_at)}</span>
                </div>
                ` : ''}
            </div>

            <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 2rem; background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px;">
                邀请邮件已发送到您的邮箱，请查收并按照邮件指引接受邀请。
            </p>

            <button onclick="location.reload()" class="btn btn-primary">
                <i data-lucide="refresh-cw"></i> 再次兑换
            </button>
        </div>
    `;
    if (window.lucide) lucide.createIcons();

    showStep(3);
}

// 显示错误结果
function showErrorResult(errorMessage) {
    const resultContent = document.getElementById('resultContent');

    resultContent.innerHTML = `
        <div class="result-error">
            <div class="result-icon"><i data-lucide="x-circle" style="width: 64px; height: 64px; color: var(--danger);"></i></div>
            <div class="result-title">兑换失败</div>
            <div class="result-message">${escapeHtml(errorMessage)}</div>

            <div style="display: flex; gap: 1rem; justify-content: center; margin-top: 2rem;">
                <button onclick="backToStep1()" class="btn btn-secondary">
                    <i data-lucide="arrow-left"></i> 返回重试
                </button>
                <button onclick="location.reload()" class="btn btn-primary">
                    <i data-lucide="rotate-ccw"></i> 重新开始
                </button>
            </div>
        </div>
    `;
    if (window.lucide) lucide.createIcons();

    showStep(3);
}

// 格式化日期
function formatDate(dateString) {
    if (!dateString) return '-';

    try {
        const date = new Date(dateString);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    } catch (e) {
        return dateString;
    }
}

// ========== 质保查询功能 ==========

// 查询质保状态
async function checkWarranty() {
    const input = document.getElementById('warrantyInput').value.trim();

    // 验证输入
    if (!input) {
        showToast('请输入原兑换码或邮箱进行查询', 'error');
        return;
    }

    let email = null;
    let code = null;

    // 简单判断是邮箱还是兑换码
    if (input.includes('@')) {
        email = input;
    } else {
        code = input;
    }

    const checkBtn = document.getElementById('checkWarrantyBtn');
    checkBtn.disabled = true;
    checkBtn.innerHTML = '<i data-lucide="loader" class="spinning"></i> 查询中...';
    if (window.lucide) lucide.createIcons();

    try {
        const response = await fetch('/warranty/check', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: email || null,
                code: code || null
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showWarrantyResult(data);
        } else {
            showToast(data.error || data.detail || '查询失败', 'error');
        }
    } catch (error) {
        showToast('网络错误，请稍后重试', 'error');
    } finally {
        checkBtn.disabled = false;
        checkBtn.innerHTML = '<i data-lucide="search"></i> 查询质保状态';
        if (window.lucide) lucide.createIcons();
    }
}

// 显示质保查询结果
function showWarrantyResult(data) {
    const warrantyContent = document.getElementById('warrantyContent');

    if (!data.has_warranty) {
        warrantyContent.innerHTML = `
            <div class="result-info" style="text-align: center; padding: 2rem;">
                <div class="result-icon"><i data-lucide="info" style="width: 48px; height: 48px; color: var(--text-muted);"></i></div>
                <div class="result-title" style="font-size: 1.2rem; margin: 1rem 0;">未找到质保信息</div>
                <div class="result-message" style="color: var(--text-muted);">${escapeHtml(data.message || '该兑换码不是质保兑换码或未找到相关记录')}</div>
            </div>
        `;
    } else {
        const warrantyStatus = data.warranty_valid ?
            '<span style="color: var(--success);">✓ 质保有效</span>' :
            '<span style="color: var(--danger);">✗ 质保已过期</span>';

        const bannedTeamsHtml = data.banned_teams && data.banned_teams.length > 0 ? `
            <div style="margin-top: 1.5rem; padding: 1rem; background: rgba(239, 68, 68, 0.1); border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.3);">
                <h4 style="margin: 0 0 0.5rem 0; color: var(--danger); font-size: 0.95rem;">
                    <i data-lucide="alert-triangle" style="width: 16px; height: 16px;"></i> 
                    被封 Team 列表
                </h4>
                ${data.banned_teams.map(team => `
                    <div style="padding: 0.5rem 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                        <div style="font-weight: 500;">${escapeHtml(team.team_name || 'Team ' + team.team_id)}</div>
                        <div style="font-size: 0.85rem; color: var(--text-muted);">${escapeHtml(team.email)}</div>
                    </div>
                `).join('')}
            </div>
        ` : '<p style="color: var(--text-muted); margin-top: 1rem;">暂无被封 Team</p>';

        const canReuseHtml = data.can_reuse ? `
            <div style="margin-top: 1.5rem; padding: 1.5rem; background: rgba(34, 197, 94, 0.1); border-radius: 8px; border: 1px solid rgba(34, 197, 94, 0.3);">
                <h4 style="margin: 0 0 1rem 0; color: var(--success); font-size: 1rem;">
                    <i data-lucide="check-circle" style="width: 18px; height: 18px;"></i> 
                    可以重复使用
                </h4>
                <p style="margin: 0 0 1rem 0; color: var(--text-secondary);">
                    您的质保兑换码可以重复使用！请复制下方兑换码，返回兑换页面重新兑换。
                </p>
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                    <input type="text" value="${escapeHtml(data.original_code)}" readonly 
                        style="flex: 1; padding: 0.75rem; background: rgba(255,255,255,0.05); border: 1px solid var(--border-base); border-radius: 6px; color: var(--text-primary); font-family: monospace; font-size: 1.1rem;">
                    <button onclick="copyWarrantyCode('${escapeHtml(data.original_code)}')" class="btn btn-primary" style="white-space: nowrap;">
                        <i data-lucide="copy"></i> 复制
                    </button>
                </div>
            </div>
        ` : '';

        warrantyContent.innerHTML = `
            <div class="warranty-details">
                <div class="result-detail-item" style="padding: 1rem; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 1rem;">
                    <span class="result-detail-label">质保状态</span>
                    <span class="result-detail-value">${warrantyStatus}</span>
                </div>
                
                ${data.warranty_expires_at ? `
                <div class="result-detail-item" style="padding: 1rem; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 1rem;">
                    <span class="result-detail-label">质保到期时间</span>
                    <span class="result-detail-value">${formatDate(data.warranty_expires_at)}</span>
                </div>
                ` : ''}
                
                <div class="result-detail-item" style="padding: 1rem; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 1rem;">
                    <span class="result-detail-label">原兑换码</span>
                    <span class="result-detail-value" style="font-family: monospace;">${escapeHtml(data.original_code)}</span>
                </div>
                
                ${bannedTeamsHtml}
                ${canReuseHtml}
            </div>
        `;
    }

    if (window.lucide) lucide.createIcons();

    // 显示质保结果区域
    document.querySelectorAll('.step').forEach(step => step.style.display = 'none');
    document.getElementById('warrantyResult').style.display = 'block';
}

// 复制质保兑换码
function copyWarrantyCode(code) {
    navigator.clipboard.writeText(code).then(() => {
        showToast('兑换码已复制到剪贴板', 'success');
    }).catch(() => {
        showToast('复制失败，请手动复制', 'error');
    });
}
