import {getData, putData, postData, deleteData} from '/static/js/api.js';
import {showNotification} from '/static/js/notification.js';
import {loadUserTokens, initTokenGeneration} from '/static/js/user_access_token.js';
import {optionalList} from '/static/js/page_dom.js';

const userListContainer = document.getElementById('userList');
const saveBtn = document.getElementById('saveBtn');
const userForm = document.getElementById('userForm');
const createNewUserBtn = document.getElementById('createNewUser');
const deleteBtn = document.getElementById('deleteBtn');

let allNodes = [];

function renderNodeSelect(nodes) {
    const select = document.getElementById('user_nodes_select');
    if (!select) return;

    select.innerHTML = '';
    nodes.forEach(node => {
        const opt = document.createElement('option');
        opt.value = node.id;
        opt.textContent = node.name;
        select.appendChild(opt);
    });
}

function renderRoleSelect(roles) {
    const select = document.getElementById('role');
    if (!select) return;

    select.innerHTML = '';
    roles.forEach(role => {
        const opt = document.createElement('option');
        opt.value = role.name;
        opt.textContent = role.name;
        select.appendChild(opt);
    });
}

/**
 * Инициализация менеджера: загрузка списка нод
 */
// Необязательный список: ручки может не быть на этой установке. Отказ здесь —
// не беда, а ответ «такого у нас нет», поэтому он глотается и даёт пустой
// список. Беду покажет обязательный запрос рядом.
async function initUsersManager(selectedUserId = null) {
    if (!userListContainer) return;

    try {
        // ⚠⚠ Обязателен только список людей. Узлы и роли — ручки ПРОЕКТА, и у
        // соседней установки их может не быть вовсе: `/node/list` есть не у
        // всех, роли иные держат списком в разметке. Раньше все три шли одним
        // `Promise.all`, и отказ любого валил остальные: страница без узлов
        // показывала не «страницу без выбора узлов», а пустоту со строкой в
        // консоли. Поэтому необязательные спрашиваются мягко.
        const [usersRes, nodeRows, roleRows] = await Promise.all([
            getData('/api/users'),
            optionalList('/node/list'),
            optionalList('/role/list')
        ]);

        const users = usersRes.result.users;
        allNodes = nodeRows.sort((a, b) => (a.position || 0) - (b.position || 0));

        // ⚠ Пустой список ролей НЕ перерисовывает выбор: у установки без
        // `/role/list` роли стоят прямо в разметке, и затирать их пустотой
        // значит оставить человека без выбора вовсе.
        if (roleRows.length) renderRoleSelect(roleRows);
        renderUserList(users, selectedUserId);
        renderNodeSelect(allNodes);
    } catch (e) {
        console.error("Ошибка инициализации пользователей:", e);
    }
}

/**
 * Отрисовка списка в левой колонке
 */
function renderUserList(users, selectedUserId = null) {
    userListContainer.innerHTML = '';

    if (users.length === 0) {
        userListContainer.innerHTML = '<div style="padding:20px; color:#999; font-size:13px;">Нет созданных пользователей</div>';
        return;
    }

    users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'user-item';
        div.setAttribute('data-id', user.id);

        div.innerHTML = `
            <span>${user.username}</span>
        `;

        div.onclick = () => selectUserForEdit(user.id, div);
        userListContainer.appendChild(div);
    });

    let targetUser = null;
    let targetElement = null;

    if (selectedUserId) {
        targetUser = users.find(u => u.id === parseInt(selectedUserId));
        if (targetUser) {
            targetElement = userListContainer.querySelector(`.user-item[data-id="${targetUser.id}"]`);
        }
    }

    if (!targetUser) {
        targetUser = users[0];
        targetElement = userListContainer.querySelector('.user-item');
    }

    if (targetUser && targetElement) {
        selectUserForEdit(targetUser.id, targetElement);
    }
}

/**
 * Загрузка данных конкретной ноды в форму
 */
async function selectUserForEdit(userId, element) {
    // Подсветка активного элемента
    document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
    element.classList.add('active');

    try {
        const data = await getData(`/api/users/${userId}`);
        const user = data.result;

        if (!user) return;

        // Заполнение полей формы
        document.getElementById('userId').value = user.id;
        document.getElementById('username').value = user.username;
        document.getElementById('email').value = user.email;
        document.getElementById('password').value = ''; // пароль не «прилипает» между пользователями
        document.getElementById('role').value = user.role ?? '';

        // Update selected options in the select element
        const userNodeIds = user.node_ids || [];
        const select = document.getElementById('user_nodes_select');
        if (select) {
            Array.from(select.options).forEach(opt => {
                opt.selected = userNodeIds.includes(parseInt(opt.value));
            });
        }

        document.getElementById('formTitle').textContent = `Редактирование пользователя: ${user.username}`;
        if (saveBtn) saveBtn.disabled = false;

        if (deleteBtn) deleteBtn.style.display = 'block';

        // Show and load tokens section
        const tokensSection = document.getElementById('tokensSection');
        if (tokensSection) tokensSection.style.display = 'block';
        await loadUserTokens(user.id);

    } catch (e) {
        console.error("Ошибка при получении данных пользователя:", e);
        showNotification('Не удалось загрузить данные пользователя', 'error');
    }
}

function resetFormForCreate() {
    document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
    userForm.reset();
    document.getElementById('userId').value = '';
    document.getElementById('formTitle').textContent = 'Создание нового пользователя';
    document.getElementById('username').value = '';
    document.getElementById('email').value = '';
    document.getElementById('password').value = '';
    const roleSelect = document.getElementById('role');
    if (roleSelect && roleSelect.options.length > 0) roleSelect.selectedIndex = 0;

    // Clear all selections in select elements
    const select = document.getElementById('user_nodes_select');
    if (select) {
        Array.from(select.options).forEach(opt => {
            opt.selected = false;
        });
    }

    if (saveBtn) saveBtn.disabled = false;
    if (deleteBtn) deleteBtn.style.display = 'none';

    // Hide tokens section
    const tokensSection = document.getElementById('tokensSection');
    if (tokensSection) tokensSection.style.display = 'none';
    const tokensList = document.getElementById('tokensList');
    if (tokensList) tokensList.innerHTML = '';
}

/**
 * Сохранение (Создание или Обновление)
 */
async function saveUserConfig(e) {
    if (e) e.preventDefault();

    // Collect selected node IDs
    const selectedNodeIds = [];
    const select = document.getElementById('user_nodes_select');
    if (select) {
        Array.from(select.selectedOptions).forEach(opt => {
            selectedNodeIds.push(parseInt(opt.value));
        });
    }

    const id = document.getElementById('userId').value;
    const roleValue = document.getElementById('role').value;
    const payload = {
        username: document.getElementById('username').value,
        email: document.getElementById('email').value,
        // ⚠ Роль уходит **именем**, а не номером: правами ведает каталог
        // (`auth_access.py`), и он знает роли по именам. Перевод имени в
        // `role_id` делает хранилище (`auth_store.py`).
        role: roleValue || '',
        node_ids: selectedNodeIds
    };

    // Пароль: только если админ заполнил поле (пустое — без изменений)
    const passwordValue = document.getElementById('password').value;
    if (passwordValue) {
        if (passwordValue.length < 8) {
            showNotification('Пароль должен быть не короче 8 символов', 'warning');
            return;
        }
        payload.password = passwordValue;
    }

    if (saveBtn) saveBtn.disabled = true;

    try {
        let targetId = id;
        if (id) {
            await putData(`/api/users/${id}`, payload);
            showNotification(`Пользователь "${payload.username}" обновлен`, 'success');
        } else {
            const res = await postData('/api/users', payload);
            showNotification(`Пользователь "${payload.username}" создан`, 'success');
            if (res && res.result && res.result.id) {
                targetId = res.result.id;
            }
        }

        // Перезагружаем список, передавая ID редактируемого или только что созданного пользователя
        await initUsersManager(targetId);

        // Если создавали новую — форма очистится, если редактировали — данные останутся
        if (!id) resetFormForCreate();

    } catch (e) {
        console.error("Ошибка сохранения пользователя:", e);
        showNotification(`Ошибка: ${e.message}`, 'error');
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

async function deleteUser() {
    const id = document.getElementById('userId').value;
    const username = document.getElementById('username').value;

    if (!id) return;

    if (confirm(`Вы уверены, что хотите удалить пользователя "${username}"?`)) {
        try {
            await deleteData(`/api/users/${id}`);
            showNotification(`Пользователь "${username}" удален`, 'success');

            resetFormForCreate();
            await initUsersManager();
        } catch (e) {
            console.error("Ошибка удаления:", e);
            showNotification(`Ошибка при удалении: ${e.message}`, 'error');
        }
    }
}

// Слушатели событий
document.addEventListener('DOMContentLoaded', () => {
    // Инициализация списка
    initUsersManager();

    // Обработка отправки формы
    if (userForm) {
        userForm.addEventListener('submit', saveUserConfig);
    }

    // Кнопка "Создать пользователя"
    if (createNewUserBtn) {
        createNewUserBtn.addEventListener('click', resetFormForCreate);
    }

    // Глазик: показать/скрыть значение пароля
    const passwordEye = document.getElementById('passwordEye');
    if (passwordEye) {
        passwordEye.addEventListener('click', () => {
            const passwordInput = document.getElementById('password');
            const show = passwordInput.type === 'password';
            passwordInput.type = show ? 'text' : 'password';
            passwordEye.textContent = show ? '🙈' : '👁';
        });
    }

    if (deleteBtn) {
        deleteBtn.addEventListener('click', deleteUser);
    }

    // Кнопка "Сгенерировать токен"
    const generateTokenBtn = document.getElementById('generateTokenBtn');
    initTokenGeneration(generateTokenBtn, () => document.getElementById('userId').value);
});
