(function () {
  "use strict";

  const STATE_KEY = "classPet.state.v1";
  const BACKUP_KEY = "classPet.backups.v1";
  const SAVE_INTERVAL = 30 * 1000;
  const MAX_BACKUPS = 3;
  const MAX_MATCH_LOGS = 10;

  const {
    SPECIES,
    SPECIES_MAP,
    NORMAL_SPECIES,
    MYTH_SPECIES,
    SHOP_ITEMS,
    SHOP_MAP,
    STAT_LABELS,
    LEGACY_SPECIES_MAP,
    assetFor,
    clamp,
    uid,
    scoreToPoints,
    createStudent,
    createPet,
    randomSpecies,
    statPool,
    allocatedPoints,
    availablePoints,
    effectiveStats,
    petMaxHp,
    combatPower,
    xpToNext,
    gainPetXp,
    winRate,
    formatTime,
  } = window.CP;

  let state = createState();
  let ui = {
    selectedStudentId: null,
    petTab: "train",
    dexTab: "pets",
    rankScope: "class",
    rankMetric: "level",
    battleA: null,
    battleB: null,
    lastBattleId: null,
    battleTab: "pvp",
    champTab: "class",
    activeTournamentId: null,
    gradeClassIds: [],
    champMatchView: null,
    champCreate: null,
    petDraw: null,
    studentQuery: "",
    pages: { students: 1, exams: 1, ranking: 1, records: 1, examEntry: 1, points: 1 },
    examDraft: {},
    examQuery: "",
  };
  let saveTimer = null;
  let lastBackupAt = null;
  let lastBackupFingerprint = "";

  const DEMO_CLASS_NAME = "演示班 · 50人";
  const DEMO_STUDENTS = [
    ["林远舟", "男"], ["陈昱宁", "女"], ["苏杭", "男"], ["周芷萱", "女"], ["顾亦航", "男"],
    ["沈梦霖", "女"], ["韩沐辰", "男"], ["杨若初", "女"], ["高子峻", "男"], ["许静仪", "女"],
    ["邓知远", "男"], ["曹雨桐", "女"], ["冯奕铭", "男"], ["彭予安", "女"], ["谢承宇", "男"],
    ["董清妍", "女"], ["曾嘉树", "男"], ["袁一诺", "女"], ["崔皓轩", "男"], ["潘悦宁", "女"],
    ["杜以恒", "男"], ["吕书瑶", "女"], ["姜明睿", "男"], ["蔡思彤", "女"], ["蒋文博", "男"],
    ["余诗涵", "女"], ["叶卓然", "男"], ["程沐阳", "男"], ["江语桐", "女"], ["严浩宇", "男"],
    ["傅星然", "女"], ["钟景行", "男"], ["尹佳琪", "女"], ["邹云帆", "男"], ["贺晓桐", "女"],
    ["石靖宇", "男"], ["金睿婕", "女"], ["侯泽恺", "男"], ["秦若曦", "女"], ["龙彦丞", "男"],
    ["兰沁瑶", "女"], ["黎俊哲", "男"], ["白芷晴", "女"], ["温皓铭", "男"], ["樊雨彤", "女"],
    ["郝晨曦", "男"], ["章艺宁", "女"], ["雷正阳", "男"], ["白景瑄", "女"], ["顾一鸣", "男"],
  ];

  function createState() {
    return {
      version: 1,
      settings: {
        currentClassId: null,
        view: "classes",
      },
      classes: [],
      students: [],
      battles: [],
      tournaments: [],
      exams: [],
    };
  }

  function qs(selector, root = document) {
    return root.querySelector(selector);
  }

  function qsa(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function refreshIcons() {
    if (window.lucide) window.lucide.createIcons();
  }

  const ARCHIVE_DB = "classPetArchive";
  const ARCHIVE_STORE = "matchLogs";

  function openArchive() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error("no idb"));
      const req = window.indexedDB.open(ARCHIVE_DB, 2);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(ARCHIVE_STORE);
        if (!req.result.objectStoreNames.contains("handles")) req.result.createObjectStore("handles");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function archiveLogs(entries) {
    // entries: [{key, log}] 火速写入 IndexedDB，失败静默（localStorage 仍有关键数据）
    openArchive().then((db) => {
      try {
        const tx = db.transaction(ARCHIVE_STORE, "readwrite");
        const store = tx.objectStore(ARCHIVE_STORE);
        entries.forEach(({ key, log }) => store.put(log, key));
      } catch (_e) { /* ignore */ }
    }).catch(() => {});
  }

  function loadArchivedLog(key) {
    return openArchive().then((db) => new Promise((resolve) => {
      try {
        const req = db.transaction(ARCHIVE_STORE, "readonly").objectStore(ARCHIVE_STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (_e) { resolve(null); }
    })).catch(() => null);
  }

  function stateFingerprint() {
    pruneTournamentLogs();
    return JSON.stringify(state);
  }

  function pruneTournamentLogs() {
    const archive = [];
    (state.tournaments || []).forEach((t) => {
      const pool = [...(t.matches || []), ...((t.knockout || []).flatMap((r) => r.matches || []))]
        .filter((m) => m.log)
        .sort((x, y) => (x.at || "").localeCompare(y.at || ""));
      pool.slice(0, Math.max(0, pool.length - MAX_MATCH_LOGS)).forEach((m) => {
        archive.push({ key: `${t.id}:${m.id}`, log: m.log });
        delete m.log;
        m.logPruned = true;
      });
    });
    if (archive.length) archiveLogs(archive);
  }

  function readBackups() {
    try {
      const parsed = JSON.parse(localStorage.getItem(BACKUP_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  function writeBackups(backups) {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(backups.slice(-MAX_BACKUPS)));
  }

  function setSaveStatus(text, saving = false) {
    const el = qs("#saveStatus");
    if (!el) return;
    el.innerHTML = `<i data-lucide="${saving ? "loader-circle" : "hard-drive-download"}"></i>${esc(text)}`;
    el.classList.toggle("is-saving", saving);
    refreshIcons();
  }

  function persistState(options = {}) {
    const payload = stateFingerprint();
    try {
      localStorage.setItem(STATE_KEY, payload);
      if (options.backup) {
        if (payload !== lastBackupFingerprint) {
          const backups = readBackups();
          backups.push({ at: new Date().toISOString(), payload });
          writeBackups(backups);
          lastBackupAt = new Date();
          lastBackupFingerprint = payload;
          updateStorageInfo();
        }
      }
      setSaveStatus(options.backup ? "定期保存完成" : "已保存");
      writeSyncFile();
      return true;
    } catch (error) {
      console.error(error);
      setSaveStatus("保存失败：存储空间不足");
      toast("本地存储写入失败，请导出 JSON 备份", "error");
      return false;
    }
  }

  function scheduleSave() {
    setSaveStatus("保存中...", true);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persistState(), 220);
  }

  function updateStorageInfo() {
    const info = qs("#storageInfo");
    const backupInfo = qs("#lastBackupInfo");
    let bytes = 0;
    try {
      bytes = new Blob([stateFingerprint()]).size;
    } catch (_error) {
      bytes = 0;
    }
    if (info) {
      info.textContent = `当前数据约 ${(bytes / 1024).toFixed(1)} KB · 自动保存于本机浏览器`;
    }
    if (backupInfo) {
      backupInfo.textContent = lastBackupAt
        ? `最近定期快照 ${formatTime(lastBackupAt)} · 保留 ${MAX_BACKUPS} 份`
        : "定期快照将在数据变化后生成";
    }
  }

  function ensureStudentShape(student) {
    student.scores ||= [];
    student.transactions ||= [];
    student.battles ||= { wins: 0, losses: 0, total: 0 };
    if (student.drawUsed === undefined) student.drawUsed = false;
    student.points = clamp(Number(student.points) || 0, 0, 1000000);
    if (student.pet) {
      student.pet.base ||= { health: 80, satiety: 80, mood: 80 };
      student.pet.stats ||= { strength: 0, speed: 0, vitality: 0, defense: 0, focus: 0 };
      student.pet.inventory ||= [];
      student.pet.equipment ||= [];
      student.pet.equipped ||= { weapon: null, armor: null, accessory: null };
      student.pet.titles ||= [];
      if (student.pet.equipped.title === undefined) student.pet.equipped.title = null;
      // 旧数据迁移：已有头衔但没有称号记录的，补一条 1 个月有效期的称号
      if (student.title && student.pet && !student.pet.titles.some((t) => t.name === student.title)) {
        const tid = uid("title");
        student.pet.titles.push({ id: tid, name: student.title, from: "历史冠军赛", gainedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 864e5).toISOString() });
        student.pet.equipped.title = tid;
      }
      // 过期清理
      const now = Date.now();
      student.pet.titles = student.pet.titles.filter((t) => !t.expiresAt || new Date(t.expiresAt) > now);
      if (student.pet.equipped.title && !student.pet.titles.some((t) => t.id === student.pet.equipped.title)) {
        student.pet.equipped.title = null;
        student.title = null;
      }
      if (student.pet.speciesId && !SPECIES_MAP[student.pet.speciesId]) {
        student.pet.speciesId = LEGACY_SPECIES_MAP[student.pet.speciesId] || null;
      }
      if (student.pet.speciesId && SPECIES_MAP[student.pet.speciesId]) {
        const allocated = allocatedPoints(student.pet);
        if (allocated > statPool(student.pet)) {
          const factor = statPool(student.pet) / allocated;
          Object.keys(student.pet.stats).forEach((key) => {
            student.pet.stats[key] = Math.floor(student.pet.stats[key] * factor);
          });
        }
      } else {
        student.pet = null;
      }
    }
    return student;
  }

  function migrateState(next) {
    next ||= createState();
    next.version ||= 1;
    next.settings ||= { currentClassId: null, view: "classes" };
    next.classes ||= [];
    next.students ||= [];
    next.battles ||= [];
    next.tournaments ||= [];
    next.exams ||= [];
    next.students.forEach(ensureStudentShape);
    (next.tournaments || []).forEach((t) => {
      const pool = [...(t.matches || []), ...((t.knockout || []).flatMap((r) => r.matches || []))].filter((m) => m.log);
      pool.slice(0, Math.max(0, pool.length - MAX_MATCH_LOGS)).forEach((m) => { delete m.log; m.logPruned = true; });
    });
    if (!next.classes.some((item) => item.id === next.settings.currentClassId)) {
      next.settings.currentClassId = next.classes[0]?.id || null;
    }
    if (next.settings.view === "shop") next.settings.view = "pets";
    if (!["classes", "pets", "dex", "points", "battle", "ranking", "records"].includes(next.settings.view)) {
      next.settings.view = "classes";
    }
    return next;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (!raw) {
        idbGetHandle().then((handle) => {
          if (!handle) return;
          fileHandle = handle;
          updateFileSyncStatus();
          restoreSyncFile().then((ok) => { if (ok) renderAll(); });
        });
        return;
      }
      state = migrateState(JSON.parse(raw));
      settleStuckTournaments();
    } catch (error) {
      console.error(error);
      toast("读取本地数据失败，已创建空白数据", "error");
      state = createState();
    }
  }

  function currentClass() {
    return state.classes.find((item) => item.id === state.settings.currentClassId) || null;
  }

  function studentsInClass(classId = state.settings.currentClassId) {
    return state.students
      .filter((student) => student.classId === classId)
      .sort((a, b) => a.studentNo.localeCompare(b.studentNo, "zh-Hans-CN", { numeric: true }) || a.name.localeCompare(b.name, "zh-Hans-CN"));
  }

  function selectedStudent() {
    const students = studentsInClass();
    let student = students.find((item) => item.id === ui.selectedStudentId);
    if (!student) student = students[0] || null;
    if (student) ui.selectedStudentId = student.id;
    return student;
  }

  function studentById(id) {
    return state.students.find((item) => item.id === id) || null;
  }

  function petArt(species, extraClass = "", level = 1) {
    if (!species) return "";
    return `<img class="pet-art ${extraClass}" src="${assetFor(species, level)}" alt="${esc(species.name)}" draggable="false" />`;
  }

  function addTransaction(student, amount, reason, type) {
    student.transactions.unshift({
      id: uid("trx"),
      amount: Math.round(amount),
      reason: String(reason || "积分变动").trim(),
      type,
      createdAt: new Date().toISOString(),
    });
    student.transactions = student.transactions.slice(0, 500);
  }

  function changePoints(student, amount, reason, type) {
    const value = Math.round(Number(amount) || 0);
    if (!value) return true;
    if (value < 0 && student.points + value < 0) return false;
    student.points = clamp(student.points + value, 0, 1000000);
    addTransaction(student, value, reason, type);
    return true;
  }

  function awardPoints(student, amount, reason, type) {
    return changePoints(student, amount, reason, type);
  }

  function announceLevelUp(student, levels) {
    if (!levels.length) return;
    toast(`${student.name} 的宠物升到 ${levels[levels.length - 1]} 级，属性点已增加`, "info");
  }

  function toast(message, type = "success") {
    const host = qs("#toastHost");
    if (!host) return;
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    const icon = type === "error" ? "circle-alert" : type === "info" ? "sparkles" : "circle-check";
    el.innerHTML = `<i data-lucide="${icon}"></i><span>${esc(message)}</span>`;
    host.appendChild(el);
    refreshIcons();
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateY(6px)";
      el.style.transition = "all .25s ease";
      setTimeout(() => el.remove(), 260);
    }, 3200);
  }

  function renderClassSelect() {
    const select = qs("#classSelect");
    if (!select) return;
    if (!state.classes.length) {
      select.innerHTML = `<option value="">请先创建班级</option>`;
      return;
    }
    if (!state.classes.some((item) => item.id === state.settings.currentClassId)) {
      state.settings.currentClassId = state.classes[0].id;
    }
    select.innerHTML = state.classes
      .map((item) => `<option value="${item.id}" ${item.id === state.settings.currentClassId ? "selected" : ""}>${esc(item.name)}</option>`)
      .join("");
  }

  function renderNav() {
    qsa(".nav-item").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.view === state.settings.view);
    });
  }

  function petName(student) {
    if (!student?.pet) return "未领养";
    return SPECIES_MAP[student.pet.speciesId]?.name || "宠物";
  }

  function studentOption(selected, student) {
    return `<option value="${student.id}" ${selected?.id === student.id ? "selected" : ""}>${esc(student.studentNo)} ${esc(student.name)} · ${esc(petName(student))}</option>`;
  }

  function metricCard(label, value) {
    return `<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  }

  function renderClassesView() {
    const view = qs("#view");
    const klass = currentClass();
    const students = studentsInClass();

    view.innerHTML = `
      <section class="page-head">
        <div>
          <h2>班级管理</h2>
          <p>创建班级后，可手动添加学生，也可按模板从 Excel 批量导入。</p>
        </div>
        <div class="button-row">
          <button class="button button-ghost" type="button" data-action="download-template"><i data-lucide="file-spreadsheet"></i>下载导入模板</button>
          <button class="button button-ghost" type="button" data-action="create-demo-class"><i data-lucide="users"></i>生成 50 人演示班</button>
          <button class="button" type="button" data-action="import-excel" ${klass ? "" : "disabled"}><i data-lucide="upload"></i>导入学生 Excel</button>
        </div>
      </section>

      <section class="panel">
        <div class="panel-heading">
          <div>
            <h3><i data-lucide="school"></i>班级</h3>
            <p>同一个浏览器内可管理多个班级。</p>
          </div>
          ${klass ? `<button class="button button-danger-ghost" type="button" data-action="delete-class" data-id="${klass.id}"><i data-lucide="trash-2"></i>删除班级</button>` : ""}
        </div>
        <form id="createClassForm" class="form-grid">
          <div class="field">
            <label for="className">班级名称</label>
            <input id="className" name="name" required maxlength="40" placeholder="例：三年级二班" />
          </div>
          <div class="field">
            <label>&nbsp;</label>
            <button class="button" type="submit"><i data-lucide="plus"></i>创建班级</button>
          </div>
        </form>
      </section>

      ${klass ? `
        <section class="panel">
          <div class="panel-heading">
            <div>
              <h3><i data-lucide="bar-chart-3"></i>${esc(klass.name)}</h3>
              <p>学生、宠物、积分与神兽数量。</p>
            </div>
            <button class="button button-accent" type="button" data-action="daily-settlement"><i data-lucide="sun"></i>每日结算</button>
          </div>
          <div class="stats-row">
            ${metricCard("学生", students.length)}
            ${metricCard("已领养宠物", students.filter((item) => item.pet).length)}
            ${metricCard("神兽", students.filter((item) => item.pet && SPECIES_MAP[item.pet.speciesId]?.rarity === "myth").length)}
            ${metricCard("班级总积分", students.reduce((sum, item) => sum + item.points, 0))}
          </div>
        </section>

        <section class="panel">
          <div class="panel-heading">
            <div>
              <h3><i data-lucide="users"></i>学生名单</h3>
              <p>支持学号、姓名、性别；同一班级内学号不重复。</p>
            </div>
          </div>
          <div class="field" style="max-width:260px;margin-bottom:14px"><label for="studentSearch">检索学生</label><input id="studentSearch" value="${esc(ui.studentQuery)}" placeholder="输入学号或姓名筛选" /></div>
          <form id="createStudentForm" class="form-grid" style="margin-bottom:16px">
            <div class="field"><label for="studentNo">学号</label><input id="studentNo" name="studentNo" required maxlength="24" placeholder="202601" /></div>
            <div class="field"><label for="studentName">姓名</label><input id="studentName" name="name" required maxlength="24" placeholder="张小满" /></div>
            <div class="field"><label for="studentGender">性别</label><select id="studentGender" name="gender"><option>女</option><option>男</option><option>其他</option></select></div>
            <div class="field"><label>&nbsp;</label><button class="button" type="submit"><i data-lucide="user-plus"></i>添加学生</button></div>
          </form>
          ${students.length ? (() => {
            const q = (ui.studentQuery || "").trim().toLowerCase();
            const shown = q ? students.filter((s) => s.studentNo.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)) : students;
            const page_ = q ? null : paginate(shown, ui.pages.students, "students");
            const rows = page_ ? page_.slice : shown;
            return rows.length ? `
            ${""/* pager moved below table */}
            <div class="table-wrap">
              <table>
                <thead><tr><th>学生</th><th>学号</th><th>性别</th><th>积分</th><th>宠物</th><th>战斗</th><th>操作</th></tr></thead>
                <tbody>
                  ${rows.map((student) => `
                    <tr>
                      <td><span class="student-name"><span class="avatar">${esc(student.name.slice(0, 1))}</span>${esc(student.name)}${student.title ? `·${titlePlate(student.title)}` : ""}</span></td>
                      <td>${esc(student.studentNo)}</td>
                      <td>${esc(student.gender)}</td>
                      <td><span class="tag tag-accent"><i data-lucide="coins"></i>${student.points}</span></td>
                      <td>${student.pet ? `<span class="student-name">${petArt(SPECIES_MAP[student.pet.speciesId], "pet-art-sm", student.pet.level)}${petPlate(student)} Lv.${student.pet.level}</span>` : `<span class="tag">未领养</span>`}</td>
                      <td>${student.battles.wins}胜 / ${student.battles.losses}负</td>
                      <td>
                        <div class="button-row">
                          <button class="button button-ghost" type="button" data-action="open-student" data-id="${student.id}" ${student.pet ? "" : `disabled title="该学生还没有宠物，请先点击抽取"`}><i data-lucide="paw-print"></i>宠物</button>
                          ${!student.drawUsed ? `<button class="button button-ghost" type="button" data-action="pet-draw" data-id="${student.id}" title="一次性机会：重抽或自选普通宠物，重抽有 5% 神兽"><i data-lucide="dices"></i>抽取</button>` : ""}
                          <button class="button button-danger-ghost button-icon" type="button" data-action="delete-student" data-id="${student.id}" title="删除学生"><i data-lucide="trash-2"></i></button>
                        </div>
                      </td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>${page_ ? page_.pagerHtml : ""}` : `<div class="empty"><strong>${q ? "没有匹配的学生" : "还没有学生"}</strong>${q ? "换个关键词试试。" : "手动添加一条，或使用 Excel 一次导入整班。"}</div>`;
          })() : `<div class="empty"><strong>还没有学生</strong>手动添加一条，或使用 Excel 一次导入整班。</div>`}
        </section>
      ` : ""}
    `;
  }

  function renderPetsView() {
    const view = qs("#view");
    const klass = currentClass();
    const students = studentsInClass();
    const student = selectedStudent();

    view.innerHTML = `
      <section class="page-head">
        <div>
          <h2>宠物养成</h2>
          <p>每名学生限养一只；基础属性负责日常状态，战斗属性负责 PVP。</p>
        </div>
        <form id="selectStudentForm" class="class-control" style="min-width:280px">
          <i data-lucide="user-round"></i>
          <select name="studentId" aria-label="选择学生">
            ${students.map((item) => studentOption(student, item)).join("") || `<option value="">暂无学生</option>`}
          </select>
        </form>
      </section>

      ${!klass ? `<section class="panel"><div class="empty"><strong>先创建班级</strong>班级是学生与宠物的容器。</div></section>` :
        !students.length ? `<section class="panel"><div class="empty"><strong>还没有学生</strong>先到班级页添加或导入学生。</div></section>` :
        !student ? "" :
        !student.pet ? renderSpeciesPicker(student) : renderPetDetail(student)}
    `;
  }

  function renderSpeciesPicker(student) {
    return `
      <section class="panel">
        <div class="panel-heading">
          <div>
            <h3><i data-lucide="egg"></i>${esc(student.name)}，选择你的伙伴</h3>
            <p>普通宠物初始 10 点，每级 +3；神兽初始 15 点，每级 +5。</p>
          </div>
        </div>
        <div class="species-grid species-grid-choose">
          ${SPECIES.map((species) => `
            <button class="species-card ${species.rarity === "myth" ? "is-mythic" : ""}" type="button" data-action="choose-species" data-id="${species.id}">
              <span class="species-art">${petArt(species, "", 8)}</span>
              <strong><span>${esc(species.name)}</span><span class="tag ${species.rarity === "myth" ? "tag-mythic" : "tag-primary"}">${species.rarity === "myth" ? "神兽" : "普通"}</span></strong>
              <p>${esc(species.desc)}</p>
            </button>
          `).join("")}
        </div>
      </section>
    `;
  }

  function baseMeter(label, key, value) {
    return `
      <div>
        <div class="meter-top"><span>${esc(label)}</span><strong>${Math.round(value)}</strong></div>
        <div class="bar bar-${key}"><span style="width:${clamp(value, 0, 100)}%"></span></div>
      </div>
    `;
  }

  function renderPetDetail(student) {
    const pet = student.pet;
    const species = SPECIES_MAP[pet.speciesId];
    const stats = effectiveStats(pet);
    const available = availablePoints(pet);
    const xpNeed = xpToNext(pet.level);
    const ownedLiving = pet.inventory
      .map((entry) => ({ ...entry, def: SHOP_MAP[entry.itemId] }))
      .filter((entry) => entry.def?.type === "living" && entry.qty > 0);

    return `
      <div class="pet-layout">
        <aside class="pet-stage">
          <div class="pet-stage-art ${species.rarity === "myth" ? "is-mythic" : ""}">
            ${petArt(species, "pet-art-lg", pet.level)}
          </div>
          <div>
            <div class="pet-title">
              <div>
                <h3>${petPlate(student)}</h3>
                <p>${speciesPlate(species)} · ${esc(student.name)}</p>
              </div>
              <span class="tag ${species.rarity === "myth" ? "tag-mythic" : "tag-primary"}">${species.rarity === "myth" ? "神兽" : "普通"}</span>
            </div>
          </div>
          <div class="button-row" style="flex-wrap:wrap">
            <span class="tag tag-accent" title="${esc(species.skill.desc)}"><i data-lucide="zap"></i>${esc(species.skill.name)} · ${skillChance(pet.level)}%</span>
            ${species.passive ? `<span class="tag tag-mythic" title="${esc(species.passive.desc)}"><i data-lucide="sparkles"></i>${esc(species.passive.name)}</span>` : ""}
          </div>
          <div>
            <div class="meter-top"><span>等级 ${pet.level} / 10</span><strong>${pet.level >= 10 ? "满级" : `${pet.xp}/${xpNeed} XP`}</strong></div>
            <div class="bar bar-xp"><span style="width:${pet.level >= 10 ? 100 : (pet.xp / xpNeed) * 100}%"></span></div>
          </div>
          <div class="meter-list">
            ${baseMeter("健康", "health", pet.base.health)}
            ${baseMeter("饱食", "satiety", pet.base.satiety)}
            ${baseMeter("心情", "mood", pet.base.mood)}
          </div>
        </aside>

        <div>
          <div class="segmented pet-tabs">
            <button type="button" data-action="pet-tab" data-value="train" class="${ui.petTab === "train" ? "is-active" : ""}"><i data-lucide="dumbbell"></i>养成</button>
            <button type="button" data-action="pet-tab" data-value="bag" class="${ui.petTab === "bag" ? "is-active" : ""}"><i data-lucide="backpack"></i>背包</button>
            <button type="button" data-action="pet-tab" data-value="shop" class="${ui.petTab === "shop" ? "is-active" : ""}"><i data-lucide="store"></i>商城</button>
          </div>
          ${ui.petTab === "train" ? (() => {
            const draft = ui.statDraft && ui.statDraft.studentId === student.id ? ui.statDraft.points : {};
            const draftTotal = Object.values(draft).reduce((sum, v) => sum + (Number(v) || 0), 0);
            const tempAvailable = available - draftTotal;
            const preview = {};
            Object.keys(STAT_LABELS).forEach((key) => { preview[key] = stats[key] + (Number(draft[key]) || 0); });
            const previewPet = { ...pet, stats: Object.fromEntries(Object.entries(pet.stats).map(([k, v]) => [k, v + (Number(draft[k]) || 0)])), equipped: pet.equipped, equipment: pet.equipment };
            return `
          <section class="panel">
            <div class="panel-heading">
              <div>
                <h3><i data-lucide="dumbbell"></i>战斗属性加点</h3>
                <p>总点数 ${allocatedPoints(pet) + draftTotal}/${statPool(pet)}，剩余 ${tempAvailable} 点。生命上限当前为 ${petMaxHp(previewPet)}。加点为暂存状态，确认后才会生效。</p>
              </div>
              <span class="tag tag-primary">战力 ${combatPower(previewPet)}</span>
            </div>
            <div class="table-wrap">
              <table class="stat-table">
                <thead><tr><th>属性</th><th>已加点</th><th>本次拟加</th><th>装备加成</th><th>最终值</th><th>操作</th></tr></thead>
                <tbody>
                  ${Object.entries(STAT_LABELS).map(([key, label]) => {
                    const bonus = stats[key] - pet.stats[key];
                    const pending = Number(draft[key]) || 0;
                    return `<tr>
                      <td>${esc(label)}</td>
                      <td><span class="stat-value">${pet.stats[key]}</span></td>
                      <td>${pending ? `<span class="bonus">+${pending}</span>` : "-"}</td>
                      <td>${bonus ? `<span class="bonus">+${bonus}</span>` : "-"}</td>
                      <td><strong>${preview[key]}</strong></td>
                      <td>
                        <div class="button-row">
                          <button class="button button-ghost button-icon" type="button" data-action="stat-dec" data-stat="${key}" ${pending <= 0 ? "disabled" : ""} title="撤销一点拟加点"><i data-lucide="minus"></i></button>
                          <button class="button button-icon" type="button" data-action="stat-inc" data-stat="${key}" ${tempAvailable <= 0 ? "disabled" : ""} title="拟加一点"><i data-lucide="plus"></i></button>
                        </div>
                      </td>
                    </tr>`;
                  }).join("")}
                </tbody>
              </table>
            </div>
            <div class="button-row" style="margin-top:14px;justify-content:flex-end">
              <button class="button button-ghost" type="button" data-action="stat-reset" ${draftTotal ? "" : "disabled"}><i data-lucide="rotate-ccw"></i>清空拟加</button>
              <button class="button" type="button" data-action="stat-confirm" ${draftTotal ? "" : "disabled"}><i data-lucide="check"></i>确认加点（共 ${draftTotal} 点）</button>
            </div>
          </section>
          `; })() : ""}
          ${ui.petTab === "bag" ? `
          <section class="panel">
            <div class="panel-heading">
              <div><h3><i data-lucide="backpack"></i>背包</h3><p>学生购买的全部物资与装备都在这里，可直接使用、装备或快捷购买。</p></div>
              <span class="tag tag-accent"><i data-lucide="coins"></i>${student.points} 积分</span>
            </div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>物品</th><th>类型</th><th>效果</th><th>数量/状态</th><th>操作</th></tr></thead>
                <tbody>
                  ${ownedLiving.map((entry) => `
                    <tr>
                      <td><span class="student-name"><img class="item-icon" src="${entry.def.asset}" alt="" />${esc(entry.def.name)}</span></td>
                      <td><span class="tag tag-primary">生活物资</span></td>
                      <td>${esc(entry.def.desc)}</td>
                      <td><strong>×${entry.qty}</strong></td>
                      <td>
                        <div class="button-row">
                          <button class="button" type="button" data-action="use-item" data-id="${entry.itemId}"><i data-lucide="play"></i>使用</button>
                          <button class="button button-ghost" type="button" data-action="buy" data-id="${entry.itemId}" ${student.points < entry.def.price ? "disabled" : ""} title="快捷购买（${entry.def.price} 积分）"><i data-lucide="plus"></i>买 ${entry.def.price}</button>
                        </div>
                      </td>
                    </tr>
                  `).join("")}
                  ${pet.equipment.map((item) => {
                    const def = SHOP_MAP[item.itemId];
                    if (!def) return "";
                    const isOn = Object.values(pet.equipped).includes(item.instanceId);
                    return `<tr>
                      <td><span class="student-name"><img class="item-icon" src="${def.asset}" alt="" />${esc(def.name)}</span></td>
                      <td><span class="tag tag-accent">装备 · ${{ weapon: "武器", armor: "护甲", accessory: "饰品" }[def.slot] || "装备"}</span></td>
                      <td>${esc(def.desc)}</td>
                      <td>${isOn ? `<span class="tag tag-primary"><i data-lucide="check"></i>已装备</span>` : `<span class="tag">未装备</span>`}</td>
                      <td>
                        ${isOn
                          ? `<button class="button button-ghost" type="button" data-action="unequip" data-slot="${def.slot}"><i data-lucide="x"></i>卸下</button>`
                          : `<button class="button" type="button" data-action="equip" data-id="${item.instanceId}"><i data-lucide="check"></i>装备</button>`}
                      </td>
                    </tr>`;
                  }).join("")}
                  ${!ownedLiving.length && !pet.equipment.length ? `<tr><td colspan="5"><div class="empty" style="border:0;padding:18px">背包是空的，可在下方快捷购买商城物资。</div></td></tr>` : ""}
                </tbody>
              </table>
            </div>
            <div class="panel-heading" style="margin:18px 0 10px"><h3><i data-lucide="crown"></i>冠军称号</h3><p>冠军赛夺冠获得的称号，佩戴后全属性 +1，有效期 1 个月；同时只能佩戴一个。</p></div>
            ${(pet.titles || []).length ? `
            <div class="table-wrap">
              <table>
                <thead><tr><th>称号</th><th>来源</th><th>获得时间</th><th>有效期至</th><th>状态</th><th>操作</th></tr></thead>
                <tbody>
                  ${(pet.titles || []).map((t) => {
                    const isOn = pet.equipped.title === t.id;
                    const expired = t.expiresAt && new Date(t.expiresAt) <= new Date();
                    return `<tr>
                      <td>${titlePlate(t.name)}</td>
                      <td>${esc(t.from || "冠军赛")}</td>
                      <td>${formatTime(t.gainedAt)}</td>
                      <td>${expired ? `<span class="tag tag-danger">已过期</span>` : `${formatTime(t.expiresAt)}`}</td>
                      <td>${isOn ? `<span class="tag tag-primary"><i data-lucide="check"></i>佩戴中</span>` : expired ? `<span class="tag">已失效</span>` : `<span class="tag">未佩戴</span>`}</td>
                      <td>${isOn
                        ? `<button class="button button-ghost" type="button" data-action="title-unequip"><i data-lucide="x"></i>卸下</button>`
                        : expired ? "" : `<button class="button" type="button" data-action="title-equip" data-id="${t.id}"><i data-lucide="check"></i>佩戴</button>`}
                      </td>
                    </tr>`;
                  }).join("")}
                </tbody>
              </table>
            </div>` : `<div class="empty" style="padding:18px"><strong>还没有称号</strong>在冠军赛夺冠即可获得专属称号。</div>`}
          </section>
          ` : ""}
          ${ui.petTab === "shop" ? `
          <section class="panel">
            <div class="panel-heading">
              <div><h3><i data-lucide="store"></i>快捷购买</h3><p>用当前学生（${esc(student.name)}）的积分直接购买，购买后立即进入背包。</p></div>
            </div>
            <div class="panel-heading" style="margin-bottom:10px"><h3><i data-lucide="apple"></i>生活物资</h3></div>
            <div class="shop-grid">
              ${SHOP_ITEMS.filter((item) => item.type === "living").map((item) => {
                const isMyth = item.type === "evolution" && species.rarity === "myth";
                const disabled = student.points < item.price || isMyth;
                const reason = isMyth ? "已是神兽" : student.points < item.price ? "积分不足" : "";
                return `
                <article class="shop-card ${item.type === "evolution" ? "is-evolution" : ""}">
                  <span class="shop-icon is-img"><img src="${item.asset}" alt="${esc(item.name)}" /></span>
                  <strong>${esc(item.name)}</strong>
                  <p>${esc(item.desc)}</p>
                  <div class="shop-card-footer">
                    <span class="price"><i data-lucide="coins"></i>${item.price}</span>
                    <button class="button" type="button" data-action="buy" data-id="${item.id}" ${disabled ? "disabled" : ""}>${reason ? esc(reason) : "购买"}</button>
                  </div>
                </article>`;
              }).join("")}
            </div>
            <div class="panel-heading" style="margin:18px 0 10px"><h3><i data-lucide="sword"></i>装备与进化核心</h3></div>
            <div class="shop-grid">
              ${SHOP_ITEMS.filter((item) => item.type === "equipment" || item.type === "evolution").map((item) => {
                const isMyth = item.type === "evolution" && species.rarity === "myth";
                const disabled = student.points < item.price || isMyth;
                const reason = isMyth ? "已是神兽" : student.points < item.price ? "积分不足" : "";
                return `
                <article class="shop-card ${item.type === "evolution" ? "is-evolution" : ""}">
                  <span class="shop-icon is-img"><img src="${item.asset}" alt="${esc(item.name)}" /></span>
                  <strong>${esc(item.name)}</strong>
                  <p>${esc(item.desc)}</p>
                  <div class="shop-card-footer">
                    <span class="price"><i data-lucide="coins"></i>${item.price}</span>
                    <button class="button" type="button" data-action="buy" data-id="${item.id}" ${disabled ? "disabled" : ""}>${reason ? esc(reason) : "购买"}</button>
                  </div>
                </article>`;
              }).join("")}
            </div>
          </section>
          ` : ""}
        </div>
      </div>
    `;
  }

  function renderDexView() {
    const view = qs("#view");
    const counts = {};
    state.students.forEach((student) => {
      if (student.pet) counts[student.pet.speciesId] = (counts[student.pet.speciesId] || 0) + 1;
    });
    const groups = [
      { title: "普通宠物", note: "初始 10 点属性，每升 1 级 +3 点，共 12 种。", list: NORMAL_SPECIES },
      { title: "神兽", note: "初始 15 点属性，每升 1 级 +5 点，共 4 种；可通过神兽进化或直接领养获得。", list: MYTH_SPECIES },
    ];

    view.innerHTML = `
      <section class="page-head">
        <div>
          <h2>图鉴</h2>
          <p>宠物、物资与装备的百科一览。</p>
        </div>
        <div class="segmented pet-tabs">
          <button type="button" data-action="dex-tab" data-value="pets" class="${ui.dexTab === "pets" ? "is-active" : ""}"><i data-lucide="paw-print"></i>宠物图鉴</button>
          <button type="button" data-action="dex-tab" data-value="items" class="${ui.dexTab === "items" ? "is-active" : ""}"><i data-lucide="package"></i>物资图鉴</button>
          <button type="button" data-action="dex-tab" data-value="gear" class="${ui.dexTab === "gear" ? "is-active" : ""}"><i data-lucide="sword"></i>装备图鉴</button>
        </div>
      </section>
      ${ui.dexTab === "items" ? `
      <section class="panel">
        <div class="panel-heading">
          <div>
            <h3><i data-lucide="package"></i>生活物资</h3>
            <p>使用后提升宠物状态，或获得经验。</p>
          </div>
        </div>
        <div class="item-grid">
          ${SHOP_ITEMS.filter((item) => item.type === "living").map((item) => `
            <article class="item-card">
              <img class="item-art" src="${item.asset}" alt="${esc(item.name)}" />
              <strong>${esc(item.name)}</strong>
              <p>${esc(item.desc)}</p>
              <span class="price"><i data-lucide="coins"></i>${item.price}</span>
            </article>
          `).join("")}
        </div>
      </section>
      ` : ""}
      ${ui.dexTab === "gear" ? `
      <section class="panel">
        <div class="panel-heading">
          <div>
            <h3><i data-lucide="sword"></i>装备与进化核心</h3>
            <p>装备提供战斗属性加成；神兽进化核心可将宠物进化为随机神兽。</p>
          </div>
        </div>
        <div class="item-grid">
          ${SHOP_ITEMS.filter((item) => item.type === "equipment" || item.type === "evolution").map((item) => `
            <article class="item-card ${item.type === "evolution" ? "is-evolution" : ""}">
              <img class="item-art" src="${item.asset}" alt="${esc(item.name)}" />
              <strong>${esc(item.name)}</strong>
              <p>${esc(item.desc)}</p>
              <span class="price"><i data-lucide="coins"></i>${item.price}</span>
            </article>
          `).join("")}
        </div>
      </section>
      ` : ""}
      ${ui.dexTab === "pets" ? groups.map((group) => `
        <section class="panel">
          <div class="panel-heading">
            <div>
              <h3><i data-lucide="${group.title === "神兽" ? "flame" : "paw-print"}"></i>${group.title}</h3>
              <p>${esc(group.note)}</p>
            </div>
          </div>
          <div class="species-grid">
            ${group.list.map((species) => `
              <button class="species-card ${species.rarity === "myth" ? "is-mythic" : ""}" type="button" data-action="dex-detail" data-id="${species.id}">
                <span class="species-art">${petArt(species, "", 1)}</span>
                <strong><span>${speciesPlate(species)}</span><span class="tag ${species.rarity === "myth" ? "tag-mythic" : "tag-primary"}">${species.rarity === "myth" ? "神兽" : "普通"}</span></strong>
                <p>${esc(species.desc)}</p>
                <span class="tag">${species.skill ? `技能：${esc(species.skill.name)}` : ""}${species.passive ? ` · 被动：${esc(species.passive.name)}` : ""}</span>
                <span class="tag">${counts[species.id] ? `本班已领养 ${counts[species.id]} 只` : "暂无人领养"}</span>
              </button>
            `).join("")}
          </div>
        </section>
      `).join("") : ""}
      ${ui.dexSpeciesId && SPECIES_MAP[ui.dexSpeciesId] ? renderDexDetail(SPECIES_MAP[ui.dexSpeciesId], counts) : ""}
    `;
  }

  function renderDexDetail(species, counts) {
    const stages = [1, 3, 5, 8];
    return `
      <div class="modal-mask" data-action="dex-close">
        <div class="modal" role="dialog" aria-label="${esc(species.name)}详情" data-stop>
          <button class="modal-close" type="button" data-action="dex-close" title="关闭"><i data-lucide="x"></i></button>
          <div class="dex-detail">
            <div class="dex-detail-art">${petArt(species, "pet-art-lg", 8)}</div>
            <div class="dex-detail-body">
              <div class="pet-title">
                <div>
                  <h3>${esc(species.name)}</h3>
                  <p>${species.rarity === "myth" ? "神兽 · 初始 15 点属性，每级 +5" : "普通 · 初始 10 点属性，每级 +3"} · ${counts[species.id] || 0} 只已领养</p>
                </div>
                <span class="tag ${species.rarity === "myth" ? "tag-mythic" : "tag-primary"}">${species.rarity === "myth" ? "神兽" : "普通"}</span>
              </div>
              <p class="dex-desc">${esc(species.desc)}</p>
              <div class="dex-skill">
                <strong><i data-lucide="zap"></i>主动技能 · ${esc(species.skill.name)}</strong>
                <p>${esc(species.skill.desc)}。</p>
                <table class="skill-chance-table"><thead><tr><th>等级</th>${Array.from({ length: 10 }, (_, i) => `<th>Lv.${i + 1}</th>`).join("")}</tr></thead>
                <tbody><tr><td>触发率</td>${Array.from({ length: 10 }, (_, i) => `<td>${skillChance(i + 1)}%</td>`).join("")}</tr></tbody></table>
                <p>每次攻击独立判定，10 级达到上限 35%。</p>
              </div>
              ${species.passive ? `
              <div class="dex-skill is-passive">
                <strong><i data-lucide="sparkles"></i>神兽被动 · ${esc(species.passive.name)}</strong>
                <p>${esc(species.passive.desc)}。</p>
              </div>` : ""}
              <div class="dex-evolution">
                <strong><i data-lucide="trending-up"></i>进化形态</strong>
                <div class="dex-evolution-row">
                  ${stages.map((stage) => `
                    <figure>
                      <img src="${assetFor(species, stage === 1 ? 1 : stage === 3 ? 4 : stage === 5 ? 6 : 10)}" alt="进化阶段" />
                      <figcaption>Lv.${stage === 1 ? "1-2" : stage === 3 ? "3-4" : stage === 5 ? "5-6" : "9-10"}</figcaption>
                    </figure>
                  `).join("")}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderPointsView() {
    const view = qs("#view");
    const students = studentsInClass();
    const student = selectedStudent();
    const transactions = students
      .flatMap((item) => item.transactions.map((trx) => ({ ...trx, student: item })))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    view.innerHTML = `
      <section class="page-head">
        <div>
          <h2>积分与成绩</h2>
          <p>成绩每 10 分换 1 积分，向下取整；满分 120 分即 12 积分。</p>
        </div>
      </section>
      ${students.length ? `
        <section class="panel">
          <div class="panel-heading">
            <div><h3><i data-lucide="clipboard-check"></i>录入考试成绩</h3><p>留空的行不会记录。满分 120 分可换 12 积分。</p></div>
          </div>
          <form id="examForm">
            <div class="form-grid" style="grid-template-columns:1fr auto auto;align-items:end;margin-bottom:12px">
              <div class="field"><label for="examTitle">考试名称</label><input id="examTitle" name="title" required maxlength="30" placeholder="第九周数学测验" /></div>
              <div class="field"><label>&nbsp;</label><div class="button-row"><button class="button button-ghost" type="button" data-action="download-exam-template" title="下载 Excel 模板（已含本班名单）"><i data-lucide="download"></i>模板</button><button class="button button-ghost" type="button" data-action="import-exam-excel"><i data-lucide="sheet"></i>导入成绩</button></div></div>
              <div class="field"><label>&nbsp;</label><button class="button button-accent" type="submit"><i data-lucide="save"></i>保存本次成绩</button></div>
            </div>
            <input type="file" id="examExcelInput" accept=".xlsx,.xls,.csv" hidden />
            <div class="field" style="max-width:260px;margin-bottom:12px"><label for="examSearch">筛选学生</label><input id="examSearch" value="${esc(ui.examQuery)}" placeholder="输入学号或姓名筛选" /></div>
            <div class="table-wrap score-table">
              <table>
                <thead><tr><th>学号</th><th>姓名</th><th>成绩</th><th>可得积分</th><th>当前积分</th></tr></thead>
                <tbody>
                  ${(() => {
                    const q = (ui.examQuery || "").trim().toLowerCase();
                    const list = q ? students.filter((s) => s.studentNo.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)) : students;
                    return paginate(list, ui.pages.examEntry, "examEntry").slice.map((item) => `
                    <tr>
                      <td>${esc(item.studentNo)}</td>
                      <td>${esc(item.name)}</td>
                      <td><input type="number" name="score_${item.id}" min="0" max="150" step="1" placeholder="0-150" data-points-for="${item.id}" value="${esc(ui.examDraft[item.id] || "")}" /></td>
                      <td><output name="out_${item.id}">${Math.floor(Number(ui.examDraft[item.id] || 0) / 10) || 0}</output></td>
                      <td>${item.points}</td>
                    </tr>
                  `).join(""); })()}
                </tbody>
              </table>
            </div>
            ${(() => {
              const q = (ui.examQuery || "").trim().toLowerCase();
              const list = q ? students.filter((s) => s.studentNo.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)) : students;
              const page_ = paginate(list, ui.pages.examEntry, "examEntry");
              return q ? "" : page_.pagerHtml;
            })()}
          </form>
        </section>

        <section class="panel">
          <div class="panel-heading"><div><h3><i data-lucide="history"></i>历次考试录入记录</h3><p>点击可展开查看每次考试的详细成绩。</p></div></div>
          ${(state.exams || []).length ? (() => { const page_ = paginate(state.exams.slice().reverse(), ui.pages.exams, "exams"); return `<div class="records-list">${page_.slice.map((exam) => `
            <details class="exam-record">
              <summary>
                <time>${formatTime(exam.createdAt)}</time>
                <strong>${esc(exam.title)}</strong>
                <span>${exam.entries.length} 人参与 · 平均 ${exam.avgScore} 分 · 共发放 ${exam.totalPoints} 积分</span>
                <i data-lucide="chevron-down"></i>
              </summary>
              <div class="table-wrap"><table>
                <thead><tr><th>学号</th><th>姓名</th><th>成绩</th><th>获得积分</th></tr></thead>
                <tbody>${exam.entries.map((e) => `
                  <tr><td>${esc(e.studentNo || "-")}</td><td>${esc(e.name || "已移除")}</td><td>${e.score}</td><td>+${e.points}</td></tr>`).join("")}
                </tbody>
              </table></div>
            </details>`).join("")}</div>${page_.pagerHtml}`;})() : `<div class="empty">还没有录入记录。</div>`}
        </section>

        <section class="panel">
          <div class="panel-heading"><div><h3><i data-lucide="graduation-cap"></i>老师额外分配</h3><p>可输入正数或负数，负数不能超过当前积分。</p></div></div>
          <form id="teacherPointsForm" class="form-grid">
            <div class="field"><label for="teacherStudent">学生</label><select id="teacherStudent" name="studentId">${students.map((item) => studentOption(student, item)).join("")}</select></div>
            <div class="field"><label for="teacherAmount">积分</label><input id="teacherAmount" name="amount" type="number" min="-1000" max="1000" step="1" required placeholder="例：5 或 -3" /></div>
            <div class="field"><label for="teacherReason">原因</label><input id="teacherReason" name="reason" required maxlength="60" placeholder="课堂表现 / 值日 / 奖惩" /></div>
            <div class="field"><label>&nbsp;</label><button class="button button-accent" type="submit"><i data-lucide="send"></i>确认分配</button></div>
          </form>
        </section>

        <section class="panel">
          <div class="panel-heading"><h3><i data-lucide="receipt"></i>最近积分记录</h3></div>
          ${(() => { const page_ = paginate(transactions, ui.pages.points, "points"); return transactions.length ? `<div class="records-list">${page_.slice.map((trx) => recordItem(trx.student, trx)).join("")}</div>${page_.pagerHtml}` : `<div class="empty">暂无积分记录。</div>`; })()}
        </section>
      ` : `<section class="panel"><div class="empty"><strong>暂无学生</strong>先到班级页导入名单。</div></section>`}
    `;
    qsa("#examForm input[data-points-for]").forEach((input) => {
      input.addEventListener("input", () => {
        const output = qs(`#examForm output[name="out_${input.dataset.pointsFor}"]`);
        if (output) output.textContent = scoreToPoints(input.value);
      });
    });
  }

  function recordItem(student, trx) {
    return `
      <div class="record-item">
        <time>${formatTime(trx.createdAt)}</time>
        <div><strong>${esc(student.name)} · ${esc(trx.reason)}</strong><span>${esc(transactionTypeLabel(trx.type))}</span></div>
        <span class="amount ${trx.amount >= 0 ? "plus" : "minus"}">${trx.amount >= 0 ? "+" : ""}${trx.amount}</span>
      </div>
    `;
  }

  function transactionTypeLabel(type) {
    return { score: "成绩积分", teacher: "老师分配", shop: "商城消费", battle: "对战积分", system: "系统" }[type] || "积分变动";
  }

  function fighterEquipment(pet) {
    if (!pet) return "";
    const items = Object.values(pet.equipped || {}).map((instanceId) => {
      const owned = (pet.equipment || []).find((item) => item.instanceId === instanceId);
      return owned ? SHOP_MAP[owned.itemId] : null;
    }).filter(Boolean);
    if (!items.length) return `<span class="tag">无装备</span>`;
    return items.map((def) => `<span class="tag tag-accent" title="${esc(def.desc)}"><i data-lucide="${def.icon}"></i>${esc(def.name)}</span>`).join("");
  }

  function battleFighter(student, role, hpState, winnerId, playing) {
    if (!student?.pet) {
      return `<div class="fighter"><strong>${esc(student?.name || "未选择")}</strong><small>还没有宠物</small></div>`;
    }
    const species = SPECIES_MAP[student.pet.speciesId];
    const stats = effectiveStats(student.pet);
    const maxHp = petMaxHp(student.pet);
    const hp = hpState ? Math.max(0, hpState.hp) : maxHp;
    const shield = hpState?.shield || 0;
    const hpPct = clamp((hp / maxHp) * 100, 0, 100);
    const low = hpPct <= 30;
    const hpBarClass = playing || hpState ? (hpPct <= 0 ? "is-dead" : low ? "is-low" : "") : "";
    return `
      <div class="fighter ${winnerId ? (student.id === winnerId ? "is-winner" : "is-loser") : ""}">
        <div class="fighter-head">
          <span class="tag ${role === "attacker" ? "tag-accent" : "tag-primary"}">${role === "attacker" ? "进攻方" : "守擂方"}</span>
          ${species.rarity === "myth" ? `<span class="tag tag-mythic">神兽</span>` : ""}
        </div>
        ${petArt(species, "pet-art-battle", student.pet.level)}
        <div><strong>${esc(student.name)}</strong><br /><small>${esc(petName(student))} Lv.${student.pet.level}</small></div>
        <div class="fighter-hp">
          <div class="meter-top"><span>生命</span><strong>${hp} / ${maxHp}${shield ? ` <span class="tag tag-primary" title="护盾">盾 ${shield}</span>` : ""}</strong></div>
          <div class="bar bar-hp ${hpBarClass}"><span style="width:${hpPct}%"></span></div>
        </div>
        <small class="fighter-stats">力 ${stats.strength} · 速 ${stats.speed} · 体 ${stats.vitality} · 防 ${stats.defense} · 会心 ${stats.focus}</small>
        <div class="button-row" style="justify-content:center">${fighterEquipment(student.pet)}</div>
        ${species.skill ? `<span class="tag" title="${esc(species.skill.desc)}"><i data-lucide="zap"></i>${esc(species.skill.name)} ${skillChance(student.pet.level)}%</span>` : ""}
        ${species.passive ? `<span class="tag tag-mythic" title="${esc(species.passive.desc)}"><i data-lucide="sparkles"></i>${esc(species.passive.name)}</span>` : ""}
      </div>
    `;
  }

  let playTimer = null;

  function stopPlayback() {
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
    }
    if (ui.playback && !ui.playback.done) ui.playback = null;
  }

  function startPlayback(frames) {
    stopPlayback();
    ui.playback = { frames, idx: 0, done: false };
    playTimer = setInterval(() => {
      const pb = ui.playback;
      if (!pb) return stopPlayback();
      if (pb.idx >= pb.frames.length - 1) {
        pb.done = true;
        stopPlaybackKeepResult();
        renderView();
        return;
      }
      pb.idx += 1;
      renderView();
      const logEl = qs("#battleLog");
      if (logEl) logEl.scrollTop = logEl.scrollHeight;
    }, 680);
  }

  function stopPlaybackKeepResult() {
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
    }
  }


  // ==================== 冠军赛系统 ====================
  function tournamentById(id) {
    return state.tournaments.find((item) => item.id === id) || null;
  }

  function groupStandings(t, group) {
    return group.memberIds.map((sid) => {
      const student = studentById(sid);
      const matches = t.matches.filter((m) => m.stage === "group" && m.groupId === group.id && m.winnerId && (m.aId === sid || m.bId === sid));
      const wins = matches.filter((m) => m.winnerId === sid).length;
      const losses = matches.length - wins;
      return { sid, student, wins, losses, pts: wins, level: student?.pet?.level || 0, power: student?.pet ? combatPower(student.pet) : 0 };
    }).sort((x, y) => y.pts - x.pts || y.level - x.level || y.power - x.power);
  }

  function buildRoundRobin(groupIndex, memberIds) {
    const matches = [];
    const ids = memberIds.slice();
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        matches.push({ id: uid("tmatch"), stage: "group", groupId: groupIndex, aId: ids[i], bId: ids[j], winnerId: null });
      }
    }
    return matches;
  }

  function snakeSplit(list, groupCount) {
    const groups = Array.from({ length: groupCount }, () => []);
    list.forEach((id, index) => {
      const cycle = Math.floor(index / groupCount) % 2;
      const pos = cycle === 0 ? index % groupCount : groupCount - 1 - (index % groupCount);
      groups[pos].push(id);
    });
    return groups;
  }

  function createClassTournament(cfg) {
    const eligible = studentsInClass().filter((s) => s.pet);
    if (eligible.length < 4) { toast("班级冠军赛至少需要 4 名已领养宠物的学生", "error"); return; }
    if (ongoingClassTournament()) { toast("本班已有进行中的班级赛，须先完赛", "error"); return; }
    const edition = (state.tournaments.filter((item) => item.kind === "class" && (item.classIds || []).includes(state.settings.currentClassId)).length + 1);
    const groups = snakeSplit(eligible.map((s) => s.id), 4);
    const t = {
      id: uid("tour"),
      kind: "class",
      name: `${currentClass()?.name || "班级"}第${edition}届`,
      createdAt: new Date().toISOString(),
      classIds: [state.settings.currentClassId],
      groups: groups.map((memberIds, i) => ({ id: i, name: `${"ABCD"[i]}组`, memberIds })),
      matches: [],
      knockout: [],
      phase: "group",
      championId: null,
    };
    t.groups.forEach((g) => { t.matches.push(...buildRoundRobin(g.id, g.memberIds)); });
    t.advancePerGroup = Math.min(4, Math.ceil(t.groups[0].memberIds.length / 2));
    if (!cfg) return;
    t.title = cfg.title;
    t.tiers = cfg.tiers;
    state.tournaments.push(t);
    ui.activeTournamentId = t.id;
    scheduleSave();
    renderView();
    toast(`已创建 ${t.name}：4 组单循环，每组前 ${t.advancePerGroup} 名晋级，冠军头衔「${t.title}」`);
  }

  function createGradeTournament(cfg) {
    const classIds = ui.gradeClassIds.filter((cid) => state.classes.some((c) => c.id === cid));
    if (classIds.length < 2) { toast("天下第一武道大会至少需要选择 2 个班级", "error"); return; }
    if (ongoingGradeTournament()) { toast("已有进行中的武道大会，须先完赛", "error"); return; }
    const gradeEdition = (state.tournaments.filter((item) => item.kind === "grade").length + 1);
    const picked = [];
    const missing = [];
    classIds.forEach((cid) => {
      // 必须先完成一届班级赛，取该班最近一届已完赛的班级赛前 16 名
      const classTour = state.tournaments
        .filter((item) => item.kind === "class" && item.classIds.includes(cid) && item.phase === "done")
        .slice(-1)[0];
      const klass = state.classes.find((c) => c.id === cid);
      if (!classTour) { missing.push(klass?.name || "未知班级"); return; }
      const rank = (sid) => {
        const idx = (classTour.placements || []).findIndex((p) => p.sid === sid);
        return idx >= 0 ? idx : 999;
      };
      const top = classTour.groups
        .flatMap((g) => groupStandings(classTour, g).map((row) => ({ sid: row.sid, pts: row.pts, tb: row.tbWins || 0, level: row.level, power: row.power, rk: rank(row.sid) })))
        .sort((x, y) => x.rk - y.rk || y.pts - x.pts || y.tb - x.tb || y.level - x.level || y.power - x.power)
        .slice(0, 16)
        .map((row) => studentById(row.sid))
        .filter((s) => s?.pet);
      if (top.length < 4) { missing.push(klass?.name || "未知班级"); return; }
      top.forEach((s) => picked.push(s.id));
    });
    if (missing.length) { toast(`以下班级还没有完成的班级赛（需先决出前 16 名）：${missing.join("、")}`, "error"); return; }
    if (picked.length < 8) { toast("参赛选手不足 8 人", "error"); return; }
    // 随机打乱后分组，每组前 4 名晋级淘汰赛
    const shuffled = picked.slice();
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    // 固定 4 组、每组最多 8 人、每组前 4 晋级 → 淘汰赛固定 16 强；超出 32 人裁掉
    const pool = shuffled.slice(0, 32);
    const groups = snakeSplit(pool, 4);
    const t = {
      id: uid("tour"),
      kind: "grade",
      name: `武道大会第${gradeEdition}届`,
      createdAt: new Date().toISOString(),
      classIds,
      classNames: classIds.map((cid) => state.classes.find((c) => c.id === cid)?.name || "未知班级"),
      groups: groups.map((memberIds, i) => ({ id: i, name: `${i + 1}组`, memberIds })),
      matches: [],
      knockout: [],
      phase: "group",
      championId: null,
    };
    t.groups.forEach((g) => { t.matches.push(...buildRoundRobin(g.id, g.memberIds)); });
    t.advancePerGroup = 4;
    if (!cfg) return;
    t.title = cfg.title;
    t.tiers = cfg.tiers;
    state.tournaments.push(t);
    ui.activeTournamentId = t.id;
    scheduleSave();
    renderView();
    toast(`已创建天下第一武道大会：${pool.length} 人随机分 4 组（每组最多 8 人），每组前 4 名晋级 16 强淘汰赛，冠军头衔「${t.title}」`);
  }

  function fightTournamentMatch(t, match) {
    if (match.winnerId) return;
    const a = studentById(match.aId);
    const b = studentById(match.bId);
    if (match.bId === null) { match.winnerId = match.aId; return; } // 轮空
    if (!a?.pet || !b?.pet) { match.winnerId = a?.pet ? match.aId : match.bId; return; }
    // 冠军赛规则：满状态出战，不消耗任何生活属性 / 积分
    const snapshot = [[a, { ...a.pet.base }], [b, { ...b.pet.base }]];
    snapshot.forEach(([student]) => { student.pet.base = { health: 100, satiety: 100, mood: 100 }; });
    const result = simulateBattle(a, b);
    snapshot.forEach(([student, base]) => { student.pet.base = base; });
    match.winnerId = result.winner.id;
    match.log = result.log;
    match.at = new Date().toISOString();
  }

  function allGroupDone(t) {
    return t.matches.every((m) => m.winnerId);
  }

  function resolveTiebreaks(t) {
    // 晋级边界积分相同时，加赛决出名次（3 局 2 胜制抢 2 胜）
    const added = [];
    t.groups.forEach((g) => {
      const standings = groupStandings(t, g);
      const cut = t.advancePerGroup;
      const cutPts = standings[cut - 1]?.pts;
      const tied = standings.filter((row) => row.pts === cutPts);
      if (tied.length > 1) {
        // 积分并列者两两加赛，胜者得 1 晋级分
        const pool = tied.map((row) => row.sid);
        for (let i = 0; i < pool.length; i += 1) {
          for (let j = i + 1; j < pool.length; j += 1) {
            const m = { id: uid("tmatch"), stage: "tiebreak", groupId: g.id, aId: pool[i], bId: pool[j], winnerId: null };
            t.matches.push(m);
            added.push(m);
          }
        }
      }
    });
    return added;
  }

  function tiebreakWins(t, sid) {
    return t.matches.filter((m) => m.stage === "tiebreak" && m.winnerId === sid).length;
  }

  function groupStandings(t, group) {
    return group.memberIds.map((sid) => {
      const student = studentById(sid);
      const matches = t.matches.filter((m) => (m.stage === "group" || m.stage === "tiebreak") && m.groupId === group.id && m.winnerId && (m.aId === sid || m.bId === sid));
      const wins = matches.filter((m) => m.winnerId === sid).length;
      const losses = matches.length - wins;
      const tb = t.matches.filter((m) => m.stage === "tiebreak" && m.groupId === group.id && m.winnerId === sid).length;
      return { sid, student, wins: wins - tb, losses, pts: wins - tb, tbWins: tb, level: student?.pet?.level || 0, power: student?.pet ? combatPower(student.pet) : 0 };
    }).sort((x, y) => y.pts - x.pts || y.tbWins - x.tbWins || y.level - x.level || y.power - x.power);
  }

  function startKnockout(t) {
    if (!allGroupDone(t)) { toast("小组赛还有未进行的比赛", "error"); return; }
    let added = [];
    if (!t.tiebreakDone) {
      added = resolveTiebreaks(t);
      t.tiebreakDone = true;
    }
    if (added.length) {
      added.forEach((m) => fightTournamentMatch(t, m));
      toast(`晋级边界积分并列，已自动进行 ${added.length} 场加赛`);
      scheduleSave();
      return; // 先渲染一次加赛结果
    }
    const qualified = [];
    t.groups.forEach((g) => {
      groupStandings(t, g).slice(0, t.advancePerGroup).forEach((row, idx) => qualified.push({ sid: row.sid, rank: idx, pts: row.pts, level: row.level, power: row.power }));
    });
    qualified.sort((x, y) => x.pts - y.pts || x.level - y.level); // 首尾配对：积分高的打积分低的
    const order = qualified.map((q) => q.sid);
    const roundMatches = [];
    for (let i = 0; i < Math.floor(order.length / 2); i += 1) {
      roundMatches.push({ id: uid("tmatch"), stage: "ko", aId: order[i], bId: order[order.length - 1 - i], winnerId: null });
    }
    if (order.length % 2 === 1) roundMatches.push({ id: uid("tmatch"), stage: "ko", aId: order[Math.floor(order.length / 2)], bId: null, winnerId: order[Math.floor(order.length / 2)] });
    t.knockout = [{ round: 1, name: roundName(roundMatches.filter((m) => m.bId !== null).length * 2), matches: roundMatches }];
    t.phase = "bracket";
  }

  function tierReward(t, rank) {
    const tiers = t.tiers || {};
    if (rank === 1) return tiers.r1 ?? 50;
    if (rank === 2) return tiers.r2 ?? 20;
    if (rank === 3 || rank === 4) return tiers.r3 ?? tiers.r4 ?? 10;
    if (rank <= 8) return tiers.r5_8 ?? 5;
    if (rank <= 16) return tiers.r9_16 ?? 2;
    return tiers.r17 ?? 0;
  }

  function computePlacements(t) {
    // 冠军 1，决赛负者 2，倒数第二轮负者 3-4，再往前各轮负者按档递推；未出线者为剩余名次
    const placements = [];
    const koLosersByRound = []; // 从决赛往前收集
    for (let i = t.knockout.length - 1; i >= 0; i -= 1) {
      const round = t.knockout[i];
      const losers = round.matches.filter((m) => m.bId !== null).map((m) => (m.winnerId === m.aId ? m.bId : m.aId));
      koLosersByRound.push(losers);
    }
    let nextRank = 1;
    placements.push({ sid: t.championId, rank: nextRank }); nextRank += 1;
    koLosersByRound.forEach((losers) => {
      losers.forEach((sid) => { placements.push({ sid, rank: nextRank }); nextRank += 1; });
    });
    const placedIds = new Set(placements.map((p) => p.sid));
    t.groups.flatMap((g) => groupStandings(t, g)).forEach((row) => {
      if (!placedIds.has(row.sid)) { placements.push({ sid: row.sid, rank: nextRank }); nextRank += 1; }
    });
    return placements;
  }

  function roundName(playerCount) {
    if (playerCount <= 2) return "总决赛";
    if (playerCount <= 4) return "半决赛";
    if (playerCount <= 8) return "1/4 决赛";
    if (playerCount <= 16) return "1/8 决赛";
    return `1/${playerCount} 决赛`;
  }

  function advanceKnockout(t) {
    const current = t.knockout[t.knockout.length - 1];
    if (!current || !current.matches.every((m) => m.winnerId)) return;
    const winners = current.matches.map((m) => m.winnerId);
    if (winners.length === 1) {
      t.phase = "done";
      t.championId = winners[0];
      const champion = studentById(winners[0]);
      const placements = computePlacements(t);
      t.placements = placements;
      placements.forEach((p) => {
        const student = studentById(p.sid);
        if (!student) return;
        const amount = tierReward(t, p.rank);
        if (amount > 0) awardPoints(student, amount, `${t.name} 第 ${p.rank} 名奖励`, "battle", false);
      });
      if (champion && champion.pet) {
        const tid = uid("title");
        champion.pet.titles = champion.pet.titles || [];
        champion.pet.titles.push({ id: tid, name: t.title, from: t.name, gainedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 864e5).toISOString() });
        champion.pet.equipped = champion.pet.equipped || {};
        if (!champion.pet.equipped.title) { champion.pet.equipped.title = tid; champion.title = t.title; }
      } else if (champion) champion.title = t.title;
      toast(`${champion?.name || "冠军"} 捧起${t.name}奖杯！获得头衔「${t.title}」，各名次奖励已按档发放`);
      return;
    }
    const nextMatches = [];
    for (let i = 0; i < Math.floor(winners.length / 2); i += 1) {
      nextMatches.push({ id: uid("tmatch"), stage: "ko", aId: winners[i], bId: winners[winners.length - 1 - i], winnerId: null });
    }
    if (winners.length % 2 === 1) nextMatches.push({ id: uid("tmatch"), stage: "ko", aId: winners[Math.floor(winners.length / 2)], bId: null, winnerId: winners[Math.floor(winners.length / 2)] });
    t.knockout.push({ round: current.round + 1, name: roundName(nextMatches.filter((m) => m.bId !== null).length * 2), matches: nextMatches });
  }

  function fighterLabel(sid) {
    const s = studentById(sid);
    if (!s) return "已移除";
    const species = SPECIES_MAP[s.pet?.speciesId];
    let label = species ? `${esc(s.name)}·${speciesPlate(species)}` : esc(s.name);
    if (s.title) label += `·${titlePlate(s.title)}`;
    return label;
  }

  function renderChampMatchRow(t, m, showGroup) {
    const done = !!m.winnerId;
    const g = t.groups.find((item) => item.id === m.groupId);
    const winTag = (sid) => (done && m.winnerId === sid ? ` <span class="win-flag">胜</span>` : "");
    return `<tr>
      <td>${showGroup && g ? esc(g.name) : ""}</td>
      <td class="${done && m.winnerId === m.aId ? "champ-win" : ""}">${fighterLabel(m.aId)}${winTag(m.aId)}</td>
      <td class="${done && m.winnerId === m.bId ? "champ-win" : ""}">${m.bId === null ? "轮空" : fighterLabel(m.bId)}${winTag(m.bId)}</td>
      <td><div class="button-row">
        ${done ? `<button class="button button-ghost" type="button" data-action="champ-detail" data-id="${t.id}" data-match="${m.id}"><i data-lucide="scroll-text"></i>详情</button>` : `<button class="button button-ghost" type="button" data-action="champ-fight" data-id="${t.id}" data-match="${m.id}"><i data-lucide="swords"></i>开打</button>`}
      </div></td>
    </tr>`;
  }

  function bracketSide(t, m, sid, label) {
    const isWinner = m.winnerId && m.winnerId === sid;
    const flag = isWinner ? `<span class="win-flag">胜</span>` : "";
    const action = m.winnerId ? "champ-detail" : "champ-fight";
    return `<button type="button" class="br-player ${isWinner ? "is-winner" : m.winnerId ? "is-loser" : ""}" data-action="${action}" data-id="${t.id}" data-match="${m.id}" title="${label.replace(/<[^>]+>/g, "")}"><span class="br-name">${label}</span>${flag}</button>`;
  }

  function renderBracket(t) {
    const cols = t.knockout.map((round) => {
      const pairs = [];
      for (let i = 0; i < round.matches.length; i += 2) pairs.push(round.matches.slice(i, i + 2));
      const pairHtml = pairs.map((pair) => {
        const slots = pair.map((m) => {
          const bye = m.bId === null;
          const aSide = bracketSide(t, m, m.aId, bye ? `${fighterLabel(m.aId)} <span class="br-bye">轮空</span>` : fighterLabel(m.aId));
          if (bye) return `<div class="br-slot"><div class="br-match">${aSide}</div></div>`;
          const bSide = bracketSide(t, m, m.bId, fighterLabel(m.bId));
          return `<div class="br-slot"><div class="br-match">${aSide}${bSide}</div></div>`;
        }).join("");
        return `<div class="br-pair${pair.length === 1 ? " br-pair-single" : ""}">${slots}</div>`;
      }).join("");
      return `<div class="br-col"><h4><span>${esc(round.name)}</span></h4><div class="br-body">${pairHtml}</div></div>`;
    }).join("");
    const champCol = t.phase === "done"
      ? `<div class="br-col br-col-champ"><h4><span><i data-lucide="trophy"></i> 冠军</span></h4><div class="br-body"><div class="br-pair br-pair-single"><div class="br-slot"><div class="br-match br-match-champ"><span class="br-player is-winner">${fighterLabel(t.championId)}</span></div></div></div></div></div>`
      : "";
    return `<div class="bracket-board">${cols}${champCol}</div>`;
  }

  let champAnimTimer = null;

  function captureStandingPositions() {
    const map = {};
    qsa(".champ-standing li").forEach((li) => { if (li.dataset.sid) map[li.dataset.sid] = li.getBoundingClientRect().top; });
    return map;
  }

  function applyStandingFLIP(prev) {
    qsa(".champ-standing li").forEach((li) => {
      const old = prev[li.dataset.sid];
      if (old == null) return;
      const delta = old - li.getBoundingClientRect().top;
      if (Math.abs(delta) < 2) return;
      li.style.transition = "none";
      li.style.transform = `translateY(${delta}px)`;
      void li.getBoundingClientRect();
      li.style.transition = "transform .55s cubic-bezier(.22,.9,.36,1)";
      li.style.transform = "";
      li.classList.add("is-moving");
      setTimeout(() => li.classList.remove("is-moving"), 600);
    });
  }

  function runChampGroupAnimation(t) {
    const pending = t.matches.filter((m) => m.stage !== "tiebreak" && !m.winnerId);
    if (!pending.length) { renderView(); return; }
    const delay = clamp(Math.round(6500 / pending.length), 140, 600);
    let i = 0;
    const step = () => {
      const prev = captureStandingPositions();
      fightTournamentMatch(t, pending[i]);
      i += 1;
      scheduleSave();
      renderView();
      applyStandingFLIP(prev);
      if (i < pending.length) champAnimTimer = setTimeout(step, delay);
      else champAnimTimer = null;
    };
    step();
  }

  function classTournaments() {
    const cid = state.settings.currentClassId;
    return (state.tournaments || []).filter((t) => t.kind !== "class" || !cid || (t.classIds || []).includes(cid));
  }
  const PAGE_SIZE = 10;
  function paginate(list, page, key, size = PAGE_SIZE) {
    const total = Math.max(1, Math.ceil(list.length / size));
    const p = Math.min(Math.max(1, page || 1), total);
    if (ui.pages[key] !== p) ui.pages[key] = p;
    const slice = list.slice((p - 1) * size, p * size);
    const pagerHtml = total <= 1 ? "" : `<div class="pager">
      <button class="button button-ghost button-icon" type="button" data-action="page" data-key="${key}" data-page="1" ${p === 1 ? "disabled" : ""}><i data-lucide="chevrons-left"></i></button>
      <button class="button button-ghost button-icon" type="button" data-action="page" data-key="${key}" data-page="${p - 1}" ${p === 1 ? "disabled" : ""}><i data-lucide="chevron-left"></i></button>
      <span class="pager-info">第 ${p} / ${total} 页 · 共 ${list.length} 条</span>
      <button class="button button-ghost button-icon" type="button" data-action="page" data-key="${key}" data-page="${p + 1}" ${p === total ? "disabled" : ""}><i data-lucide="chevron-right"></i></button>
      <button class="button button-ghost button-icon" type="button" data-action="page" data-key="${key}" data-page="${total}" ${p === total ? "disabled" : ""}><i data-lucide="chevrons-right"></i></button>
    </div>`;
    return { slice, pagerHtml };
  }

  function settleStuckTournaments() {
    (state.tournaments || []).forEach((t) => {
      let guard = 0;
      while (t.phase === "bracket" && t.knockout?.length && t.knockout[t.knockout.length - 1].matches.every((m) => m.winnerId) && guard < 8) {
        advanceKnockout(t);
        guard += 1;
      }
    });
  }

  function ongoingClassTournament() {
    const cid = state.settings.currentClassId;
    return (state.tournaments || []).find((t) => t.kind === "class" && t.phase !== "done" && (!cid || (t.classIds || []).includes(cid))) || null;
  }

  function ongoingGradeTournament() {
    return (state.tournaments || []).find((t) => t.kind === "grade" && t.phase !== "done") || null;
  }

  function champBadge(kind) {
    const count = state.tournaments.filter((item) => item.kind === kind && item.phase !== "done").length;
    return count ? `<span class="champ-badge">${count}</span>` : "";
  }

  function renderChampView() {
    const view = qs("#view");
    const tournaments = classTournaments();
    const eligibleCount = studentsInClass().filter((s) => s.pet).length;
    const kind = ui.champTab === "class" ? "class" : "grade";
    const activeT = tournamentById(ui.activeTournamentId);
    const t = (activeT && activeT.kind === kind && (kind === "grade" || !state.settings.currentClassId || (activeT.classIds || []).includes(state.settings.currentClassId)))
      ? activeT
      : tournaments.filter((item) => item.kind === kind).slice(-1)[0] || null;
    if (t) ui.activeTournamentId = t.id;

    let body = "";
    if (ui.champTab === "class") {
      const eligible = studentsInClass().filter((s) => s.pet);
      body = t ? "" : `
        <section class="panel">
          <div class="empty"><strong>还没有班级冠军赛</strong>
            <p>本班已领养宠物 ${eligibleCount} 人。赛制：全班分 4 组单循环，胜 1 分负 0 分，每组前 4 名晋级淘汰赛，一路打到冠军。</p>
          </div>
        </section>`;
    } else {
      const selected = ui.gradeClassIds;
      // 没有进行中的武道大会时，即使有历史赛事也展示班级选择，方便举办新一届
      body = t && ongoingGradeTournament() ? "" : `
        <section class="panel">
          <div class="panel-heading"><div><h3><i data-lucide="swords"></i>选择参赛班级</h3><p>每个班必须先打完一届班级赛，取前 16 名参赛；多班选手随机混编分组，每组前 4 名晋级淘汰赛。右上角「逐鹿武道大会」开始。</p></div></div>
          <div class="champ-class-list">
            ${state.classes.map((c) => {
              const cnt = studentsInClass(c.id).filter((s) => s.pet).length;
              const hasDoneTour = state.tournaments.some((item) => item.kind === "class" && item.classIds.includes(c.id) && item.phase === "done");
              return `<label class="champ-class-item"><input type="checkbox" data-action="grade-class-toggle" data-id="${c.id}" ${selected.includes(c.id) ? "checked" : ""} /> ${esc(c.name)}（${cnt} 人有宠物）${hasDoneTour ? `<span class="tag tag-primary">已决出前 16</span>` : `<span class="tag">未完成班级赛</span>`}</label>`;
            }).join("") || `<div class="empty">还没有班级。</div>`}
          </div>
        </section>`;
    }

    const gradePrefix = (kind === "grade" && !ongoingGradeTournament()) ? body : "";
    if (t) {
      const groupDone = allGroupDone(t);
      const champion = t.championId ? studentById(t.championId) : null;
      body = `${gradePrefix}${gradePrefix ? "<hr style='border:none;border-top:1px dashed var(--line);margin:6px 0' />" : ""}` + `
        ${champion ? `
        <section class="panel champ-podium">
          <div><span class="tag tag-mythic"><i data-lucide="trophy"></i>冠军</span></div>
          <div class="champ-champion"><span class="avatar avatar-lg">${esc(champion.name.slice(0, 1))}</span>
            <div><h3>${esc(champion.name)}·${titlePlate(t.title || "冠军")}</h3><p>${fighterLabel(champion.id)} · ${esc(t.name)} · ${formatTime(t.createdAt)}</p></div>
          </div>
        </section>` : ""}
        ${t.knockout.length ? `
        <section class="panel">
          <div class="panel-heading">
            <div><h3><i data-lucide="git-fork"></i>淘汰赛</h3><p>首尾配对，胜者晋级；决赛胜者成为冠军（冠军奖励 50 积分）。</p></div>
            <div class="button-row">
              ${t.phase === "bracket" ? `<button class="button button-ghost" type="button" data-action="champ-round" data-id="${t.id}"><i data-lucide="play"></i>一键进行本轮淘汰赛</button>` : ""}
              ${t.phase === "bracket" && t.knockout[t.knockout.length - 1].matches.every((m) => m.winnerId) ? `<button class="button button-accent" type="button" data-action="champ-ko-next" data-id="${t.id}"><i data-lucide="arrow-right"></i>进入下一轮</button>` : ""}
            </div>
          </div>
          ${renderBracket(t)}
          <details class="champ-matches">
            <summary>淘汰赛全部对阵明细</summary>
            <div class="table-wrap"><table>
              <thead><tr><th></th><th>选手 A</th><th>选手 B</th><th>结果</th></tr></thead>
              <tbody>${t.knockout.flatMap((round) => round.matches.map((m) => renderChampMatchRow(t, m, false))).join("")}</tbody>
            </table></div>
          </details>
        </section>` : ""}
        <section class="panel">
          <div class="panel-heading">
            <div><h3><i data-lucide="users"></i>小组赛 · ${t.groups.length} 组单循环（胜 1 分）</h3>
            <p>${t.kind === "class" ? "班级赛" : "天下第一武道大会"} · 每组前 ${t.advancePerGroup} 名晋级淘汰赛${t.kind === "grade" ? "，参赛班级见历届赛事详情" : ""}。</p></div>
            <div class="button-row">
              <button class="button button-ghost" type="button" data-action="champ-round" data-id="${t.id}" ${t.phase === "group" && groupDone ? "disabled" : ""}><i data-lucide="play"></i>一键进行剩余小组赛</button>
              ${t.phase === "group" && groupDone ? (() => {
                const tbPending = !t.tiebreakDone || t.matches.some((m) => m.stage === "tiebreak" && !m.winnerId);
                return tbPending
                  ? `<button class="button button-accent" type="button" data-action="champ-ko" data-id="${t.id}"><i data-lucide="swords"></i>加赛</button>`
                  : `<button class="button button-accent" type="button" data-action="champ-ko" data-id="${t.id}"><i data-lucide="git-merge"></i>生成淘汰赛对阵</button>`;
              })() : ""}
            </div>
          </div>
          <div class="champ-groups">
            ${t.groups.map((g) => `
              <div class="champ-group">
                <h4>${esc(g.name)} · ${g.memberIds.length} 人</h4>
                <ul class="champ-standing">
                  ${groupStandings(t, g).map((row, idx) => `
                  <li data-sid="${row.sid}" class="${idx < t.advancePerGroup ? "champ-qualified" : ""}">
                    <span class="champ-rank ${idx === 0 ? "gold" : idx === 1 ? "silver" : idx === 2 ? "bronze" : ""}">${idx + 1}</span>
                    <span class="champ-fighter">${fighterLabel(row.sid)}</span>
                    <span class="champ-record">${row.wins}胜${row.losses}负</span>
                    <strong class="champ-pts">${row.pts}${row.tbWins ? `<span class="champ-pts-tb">+${row.tbWins}</span>` : ""}</strong>
                    ${idx < t.advancePerGroup ? `<span class="tag tag-primary">晋级</span>` : ""}
                  </li>`).join("")}
                </ul>
              </div>`).join("")}
          </div>
          <details class="champ-matches">
            <summary>全部小组赛对阵（${t.matches.filter((m) => m.winnerId).length}/${t.matches.length} 已完成）</summary>
            <div class="table-wrap"><table>
              <thead><tr><th>组</th><th>选手 A</th><th>选手 B</th><th>结果</th></tr></thead>
              <tbody>${t.matches.map((m) => renderChampMatchRow(t, m, true)).join("")}</tbody>
            </table></div>
          </details>
        </section>
        <section class="panel">
          <div class="panel-heading">
            <div><h3><i data-lucide="history"></i>历届${ui.champTab === "class" ? "班级冠军赛" : "武道大会"}</h3></div>
          </div>
          ${tournaments.filter((item) => item.kind === t.kind).length ? `<div class="table-wrap"><table>
            <thead><tr><th>赛事</th><th>创建时间</th><th>状态</th><th>冠军</th><th>奖励</th><th></th></tr></thead>
            <tbody>${tournaments.filter((item) => item.kind === t.kind).slice().reverse().map((item) => `
              <tr class="${item.id === t.id ? "champ-active" : ""}">
                <td>${esc(item.name)}</td>
                <td>${formatTime(item.createdAt)}</td>
                <td>${item.phase === "done" ? "已结束" : item.phase === "bracket" ? "淘汰赛进行中" : "小组赛进行中"}</td>
                <td>${item.championId ? fighterLabel(item.championId) : "-"}</td>
                <td><span class="tag tag-accent"><i data-lucide="coins"></i>冠军 +${(item.tiers || {}).r1 ?? 50}</span></td>
                <td><div class="button-row">
                  <button class="button button-ghost" type="button" data-action="champ-view" data-id="${item.id}">查看</button>
                  ${item.kind === "grade" ? `<button class="button button-ghost" type="button" data-action="champ-classes" data-id="${item.id}" title="查看参赛班级"><i data-lucide="school"></i>参赛班级</button>` : ""}
                </div></td>
              </tr>`).join("")}</tbody>
          </table></div>` : `<div class="empty">暂无。</div>`}
        </section>`;
    }

    view.innerHTML = `
      <section class="page-head page-head-column">
        <div>
          <h2>宠物对战</h2>
          <p>小组赛 + 淘汰赛赛制；友谊表演赛不消耗积分，冠军独得 50 积分。</p>
        </div>
      </section>
      <div class="battle-main-tabs">
        <button type="button" data-action="battle-tab" data-value="pvp" class=""><i data-lucide="swords"></i>个人对战</button>
        <button type="button" data-action="battle-tab" data-value="champ" class="is-active"><i data-lucide="trophy"></i>冠军赛</button>
      </div>
      <div class="champ-toolbar">
        <div class="champ-scope">
          <button type="button" data-action="champ-tab" data-value="class" class="${ui.champTab === "class" ? "is-active" : ""}"><i data-lucide="school"></i>班级赛${champBadge("class")}</button>
          <button type="button" data-action="champ-tab" data-value="grade" class="${ui.champTab === "grade" ? "is-active" : ""}"><i data-lucide="swords"></i>武道大会${champBadge("grade")}</button>
        </div>
        ${ui.champTab === "class"
          ? (() => { const on = ongoingClassTournament(); return `<button class="button button-accent" type="button" data-action="champ-create-class" ${eligibleCount >= 4 && !on ? "" : "disabled"} title="${on ? "本班已有进行中的班级赛" : eligibleCount < 4 ? "至少需要 4 名已领养宠物的学生" : ""}"><i data-lucide="plus"></i>举办班级赛</button>`; })()
          : (() => { const on = ongoingGradeTournament(); return `<button class="button button-accent" type="button" data-action="champ-create-grade" ${ui.gradeClassIds.length >= 2 && !on ? "" : "disabled"} title="${on ? "已有进行中的武道大会" : ui.gradeClassIds.length < 2 ? "至少选择 2 个班级" : ""}"><i data-lucide="plus"></i>逐鹿武道大会</button>`; })()}
      </div>
      ${body}
      ${renderChampMatchModal()}
      ${renderChampCreateModal()}
  `;
  }

  function renderChampCreateModal() {
    if (!ui.champCreate) return "";
    const isClass = ui.champCreate === "class";
    return `
      <div class="modal-mask" data-action="champ-create-cancel">
        <div class="modal modal-sm" role="dialog" data-stop>
          <button class="modal-close" type="button" data-action="champ-create-cancel" title="关闭"><i data-lucide="x"></i></button>
          <form id="champCreateForm" class="champ-create-form">
            <div class="champ-create-head">
              <h3><i data-lucide="trophy"></i>${isClass ? "举办班级冠军赛" : "逐鹿天下第一武道大会"}</h3>
              <p>${isClass ? "全班分 4 组单循环，每组前 4 名晋级淘汰赛" : "各班取班级赛前 16 名混编分组，小组赛 + 淘汰赛"}</p>
            </div>
            <div class="champ-create-section">
              <label class="section-label" for="champTitle"><i data-lucide="crown"></i>冠军头衔<span>夺冠后永久佩戴，2-10 个字</span></label>
              <div class="title-input-row">
                <input id="champTitle" name="title" required minlength="2" maxlength="10" value="${isClass ? "群雄逐鹿" : "天下第一"}" placeholder="如：班级王者" />
                <span class="title-preview preview-name">张三·<span class="myth-plate">凤凰</span>·<span class="title-plate" id="titlePreviewText">${isClass ? "群雄逐鹿" : "天下第一"}</span></span>
              </div>
            </div>
            <div class="champ-create-section">
              <span class="section-label"><i data-lucide="coins"></i>名次奖励<span>单位积分，允许 0</span></span>
              <div class="champ-reward-grid">
                <label class="reward-cell is-top"><input name="r1" type="number" min="0" max="9999" value="50" /><em>🥇 第 1 名</em></label>
                <label class="reward-cell is-top"><input name="r2" type="number" min="0" max="9999" value="20" /><em>🥈 第 2 名</em></label>
                <label class="reward-cell"><input name="r3" type="number" min="0" max="9999" value="10" /><em>第 3 名</em></label>
                <label class="reward-cell"><input name="r4" type="number" min="0" max="9999" value="10" /><em>第 4 名</em></label>
                <label class="reward-cell"><input name="r5_8" type="number" min="0" max="9999" value="5" /><em>第 5-8 名</em></label>
                <label class="reward-cell"><input name="r9_16" type="number" min="0" max="9999" value="2" /><em>第 9-16 名</em></label>
                <label class="reward-cell is-wide"><input name="r17" type="number" min="0" max="9999" value="0" /><em>第 17 名及以后</em></label>
              </div>
            </div>
            <div class="champ-create-foot">
              <button class="button button-ghost" type="button" data-action="champ-create-cancel">取消</button>
              <button class="button button-accent" type="submit"><i data-lucide="check"></i>创建赛事</button>
            </div>
          </form>
        </div>
      </div>`;
  }

  function renderChampMatchModal() {
    if (!ui.champMatchView) return "";
    const t = tournamentById(ui.champMatchView.tid);
    const pool = t ? [...t.matches, ...(t.knockout || []).flatMap((r) => r.matches)] : [];
    const m = t && pool.find((item) => item.id === ui.champMatchView.mid);
    if (!m) return "";
    const g = t.groups.find((item) => item.id === m.groupId);
    const stageLabel = m.stage === "tiebreak" ? "加赛" : m.stage === "group" ? `小组赛 · ${g ? g.name : ""}` : "淘汰赛";
    return `
      <div class="modal-mask" data-action="champ-detail-close">
        <div class="modal modal-match" role="dialog" data-stop>
          <button class="modal-close" type="button" data-action="champ-detail-close" title="关闭"><i data-lucide="x"></i></button>
          <div class="match-detail">
            <div class="match-detail-head">
              <h3>${fighterLabel(m.aId)} <span class="match-vs">vs</span> ${m.bId === null ? "轮空" : fighterLabel(m.bId)}</h3>
              <p>${esc(t.name)} · ${stageLabel}${m.at ? ` · ${formatTime(m.at)}` : ""}</p>
            </div>
            <div class="battle-log"><ol>${(m.log || [m.logPruned ? "（该场战报已自动清理，仅保留最近比赛的完整记录）" : "（轮空，无战斗记录）"]).map((line) => `<li>${esc(line)}</li>`).join("")}</ol></div>
          </div>
        </div>
      </div>`;
  }

  function renderBattleView() {
    const view = qs("#view");
    if (ui.battleTab === "champ") { renderChampView(); return; }
    const students = studentsInClass();
    if (!ui.battleA || !students.some((item) => item.id === ui.battleA)) ui.battleA = students[0]?.id || null;
    if (!ui.battleB || !students.some((item) => item.id === ui.battleB)) ui.battleB = students[1]?.id || null;
    if (ui.battleA && ui.battleA === ui.battleB) ui.battleB = students.find((item) => item.id !== ui.battleA)?.id || null;
    const a = studentById(ui.battleA);
    const b = studentById(ui.battleB);
    const pb = ui.playback;
    const lastBattle = state.battles.find((item) => item.id === ui.lastBattleId) || state.battles.find((item) => item.classId === state.settings.currentClassId) || null;
    const lowHealth = (s) => s?.pet && s.pet.base.health < 30;
    const canBattle = a && b && a.id !== b.id && a.pet && b.pet && a.points >= 10 && b.points >= 10 && !lowHealth(a) && !lowHealth(b);
    const playing = !!(pb && !pb.done);
    const frame = pb ? pb.frames[Math.min(pb.idx, pb.frames.length - 1)] : null;
    const visibleFrames = pb ? pb.frames.slice(0, pb.idx + 1) : lastBattle?.log.map((line) => ({ line })) || [];
    const winnerId = pb && pb.done ? (frame?.a && frame.a.hp <= 0 ? b?.id : a?.id) : (!pb && lastBattle ? lastBattle.winnerId : null);

    view.innerHTML = `
      <section class="page-head page-head-column">
        <div>
          <h2>宠物对战</h2>
          <p>${ui.battleTab === "pvp" ? "双方各消耗 10 积分开启战斗；胜者获得 20 积分，败者不得返还。" : "小组赛 + 淘汰赛赛制；友谊表演赛不消耗积分，冠军独得 50 积分。"}</p>
        </div>
      </section>
      <div class="battle-main-tabs">
        <button type="button" data-action="battle-tab" data-value="pvp" class="${ui.battleTab === "pvp" ? "is-active" : ""}"><i data-lucide="swords"></i>个人对战</button>
        <button type="button" data-action="battle-tab" data-value="champ" class="${ui.battleTab === "champ" ? "is-active" : ""}"><i data-lucide="trophy"></i>冠军赛</button>
      </div>
      ${students.length < 2 ? `<section class="panel"><div class="empty"><strong>至少需要两名学生</strong>且双方都已领养宠物，才能开启 PVP。</div></section>` : `
        <section class="panel">
          <form id="battleForm" class="form-grid" style="grid-template-columns:1fr 1fr auto;align-items:end">
            <div class="field"><label for="battleA">进攻方</label><select id="battleA" name="a">${students.map((item) => `<option value="${item.id}" ${item.id === ui.battleA ? "selected" : ""}>${esc(item.studentNo)} ${esc(item.name)} · ${esc(petName(item))}</option>`).join("")}</select></div>
            <div class="field"><label for="battleB">守擂方</label><select id="battleB" name="b">${students.map((item) => `<option value="${item.id}" ${item.id === ui.battleB ? "selected" : ""}>${esc(item.studentNo)} ${esc(item.name)} · ${esc(petName(item))}</option>`).join("")}</select></div>
            <div class="field"><label>&nbsp;</label><button class="button button-accent" type="submit" ${canBattle && !playing ? "" : "disabled"}><i data-lucide="swords"></i>${playing ? "战斗中..." : "开启战斗"}</button></div>
          </form>
          ${!canBattle ? `<p style="margin:12px 0 0;color:var(--danger);font-size:12px">需要两名不同学生、双方已领养宠物、双方积分不低于 10${lowHealth(a) || lowHealth(b) ? "，且双方宠物健康不低于 30（健康过低禁止战斗）" : ""}。</p>` : ""}
        </section>
        <section class="panel">
          <div class="arena">
            ${battleFighter(a, "attacker", frame?.a, winnerId, playing)}
            <div class="vs">${playing ? `<span class="tag tag-accent">回合 ${pb.idx}</span>` : "VS"}</div>
            ${battleFighter(b, "defender", frame?.b, winnerId, playing)}
          </div>
          ${visibleFrames.length ? `
            <div class="panel-heading" style="margin-bottom:10px">
              <h3><i data-lucide="scroll-text"></i>战斗记录</h3>
              <div class="button-row">
                ${playing ? `<span class="tag tag-accent"><i data-lucide="loader-circle"></i>回放中</span>` : lastBattle ? `<button class="button button-ghost" type="button" data-action="replay-battle" data-id="${lastBattle.id}"><i data-lucide="rotate-ccw"></i>重播</button>` : ""}
                ${!playing && lastBattle ? `<span class="tag tag-primary">${esc(studentById(lastBattle.winnerId)?.name || "胜者已移除")} 获胜 · ${formatTime(lastBattle.createdAt)}</span>` : ""}
              </div>
            </div>
            <div class="battle-log" id="battleLog"><ol>${visibleFrames.map((item) => `<li>${esc(item.line)}</li>`).join("")}</ol></div>
          ` : `<div class="empty"><strong>还没有战斗</strong>选择进攻方与守擂方后开启第一场 PVP。</div>`}
        </section>
      `}
    `;
  }

  function renderRankingView() {
    const view = qs("#view");
    const students = ui.rankScope === "all" ? state.students.slice() : studentsInClass();
    const ranked = students
      .filter((student) => student.pet)
      .sort((a, b) => {
        if (ui.rankMetric === "winRate") {
          const rateA = winRate(a);
          const rateB = winRate(b);
          return rateB - rateA || b.battles.total - a.battles.total || b.pet.level - a.pet.level || combatPower(b.pet) - combatPower(a.pet);
        }
        return b.pet.level - a.pet.level || b.pet.xp - a.pet.xp || combatPower(b.pet) - combatPower(a.pet);
      });

    const page_ = paginate(ranked, ui.pages.ranking, "ranking");
    view.innerHTML = `
      <section class="page-head">
        <div>
          <h2>排行榜</h2>
          <p>按宠物等级或胜率查看班级与全校排名。</p>
        </div>
        <div class="button-row">
          <div class="segmented">
            <button type="button" data-action="rank-scope" data-value="class" class="${ui.rankScope === "class" ? "is-active" : ""}">本班</button>
            <button type="button" data-action="rank-scope" data-value="all" class="${ui.rankScope === "all" ? "is-active" : ""}">全部班级</button>
          </div>
          <div class="segmented">
            <button type="button" data-action="rank-metric" data-value="level" class="${ui.rankMetric === "level" ? "is-active" : ""}">等级</button>
            <button type="button" data-action="rank-metric" data-value="winRate" class="${ui.rankMetric === "winRate" ? "is-active" : ""}">胜率</button>
          </div>
        </div>
      </section>
      <section class="panel">
        ${ranked.length ? `
          <div class="table-wrap">
            <table>
              <thead><tr><th>名次</th><th>学生</th><th>宠物</th><th>等级</th><th>战力</th><th>胜 / 负</th><th>胜率</th><th>积分</th></tr></thead>
              <tbody>
                ${page_.slice.map((student) => {
                  const index = ranked.indexOf(student);
                  const species = SPECIES_MAP[student.pet.speciesId];
                  return `<tr>
                    <td><span class="rank-medal ${index === 0 ? "gold" : index === 1 ? "silver" : index === 2 ? "bronze" : ""}">${index + 1}</span></td>
                    <td><span class="student-name"><span class="avatar">${esc(student.name.slice(0, 1))}</span>${esc(student.name)}${student.title ? `·${titlePlate(student.title)}` : ""}</span></td>
                    <td><span class="student-name">${petArt(species, "pet-art-sm", student.pet.level)}${petPlate(student)}${species.rarity === "myth" ? `<span class="tag tag-mythic">神兽</span>` : ""}</span></td>
                    <td>Lv.${student.pet.level}</td>
                    <td>${combatPower(student.pet)}</td>
                    <td>${student.battles.wins} / ${student.battles.losses}</td>
                    <td>${winRate(student).toFixed(1)}%</td>
                    <td>${student.points}</td>
                  </tr>`;
                }).join("")}
              </tbody>
            </table>
          </div>
          ${page_.pagerHtml}
        ` : `<div class="empty"><strong>暂无可排名宠物</strong>学生领养宠物后自动进入排行榜。</div>`}
      </section>
    `;
  }

  function renderRecordsView() {
    const view = qs("#view");
    const classStudents = studentsInClass();
    const transactions = classStudents
      .flatMap((student) => student.transactions.map((trx) => ({ ...trx, student })))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 100);
    const battles = state.battles
      .filter((item) => item.classId === state.settings.currentClassId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 30);

    view.innerHTML = `
      <section class="page-head">
        <div><h2>班级记录</h2><p>集中查看积分流水与战斗历史。</p></div>
      </section>
      <section class="panel">
        <div class="panel-heading"><h3><i data-lucide="receipt"></i>积分流水</h3></div>
        ${(() => { const page_ = paginate(transactions, ui.pages.records, "records"); return transactions.length ? `<div class="records-list">${page_.slice.map((trx) => recordItem(trx.student, trx)).join("")}</div>${page_.pagerHtml}` : `<div class="empty">暂无记录。</div>`; })()}
      </section>
      <section class="panel">
        <div class="panel-heading"><h3><i data-lucide="swords"></i>战斗历史</h3></div>
        ${battles.length ? `<div class="records-list">${battles.map((battle) => {
          const a = studentById(battle.aId);
          const b = studentById(battle.bId);
          const winner = studentById(battle.winnerId);
          return `<div class="record-item"><time>${formatTime(battle.createdAt)}</time><div><strong>${esc(a?.name || "已移除")} vs ${esc(b?.name || "已移除")}</strong><span>胜者：${esc(winner?.name || "已移除")}</span></div><span class="amount plus">+20</span></div>`;
        }).join("")}</div>` : `<div class="empty">暂无战斗历史。</div>`}
      </section>
    `;
  }

  function renderPetDrawModal() {
    if (!ui.petDraw) return "";
    const student = studentById(ui.petDraw);
    if (!student || student.drawUsed) return "";
    const species = student.pet ? SPECIES_MAP[student.pet.speciesId] : null;
    return `
      <div class="modal-mask" data-action="pet-draw-close">
        <div class="modal modal-sm" role="dialog" data-stop>
          <button class="modal-close" type="button" data-action="pet-draw-close" title="关闭"><i data-lucide="x"></i></button>
          <div class="draw-modal">
            <h3><i data-lucide="dices"></i>${esc(student.name)} 的宠物抽取</h3>
            <p class="draw-current">当前：${species ? `${petPlate(student)} Lv.${student.pet.level}` : "未领养"}</p>
            <p class="draw-tip">每个学生仅有 <strong>1 次</strong> 机会，抽取会替换当前宠物（等级、加点、装备和背包清空）。重新抽取有 <strong>5%</strong> 概率直接获得神兽！</p>
            <div class="draw-actions">
              <button class="button button-accent" type="button" data-action="pet-draw-roll" data-id="${student.id}"><i data-lucide="dices"></i>重新抽取（5% 神兽）</button>
              <span class="draw-or">或</span>
              <button class="button button-ghost" type="button" data-action="pet-draw-pick" data-id="${student.id}"><i data-lucide="hand"></i>自选一只普通宠物</button>
            </div>
            <div id="drawPickArea" class="draw-pick" hidden>
              <div class="species-grid species-grid-choose">
                ${NORMAL_SPECIES.map((sp) => `
                  <button class="species-card" type="button" data-action="pet-draw-choose" data-id="${student.id}" data-species="${sp.id}">
                    <span class="species-art">${petArt(sp, "", 1)}</span>
                    <strong><span>${esc(sp.name)}</span></strong>
                    <p>${esc(sp.skill.name)}</p>
                  </button>`).join("")}
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  function renderView() {
    const view = qs("#view");
    if (!view) return;
    const renderers = {
      classes: renderClassesView,
      pets: renderPetsView,
      dex: renderDexView,
      points: renderPointsView,
      battle: renderBattleView,
      ranking: renderRankingView,
      records: renderRecordsView,
    };
    (renderers[state.settings.view] || renderClassesView)();
    const drawMount = qs("#drawModalMount");
    if (drawMount) drawMount.innerHTML = renderPetDrawModal();
    refreshIcons();
  }

  function renderAll() {
    renderClassSelect();
    renderNav();
    renderView();
    updateStorageInfo();
  }

  function downloadFile(filename, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadTemplate() {
    const rows = [
      ["学号", "姓名", "性别", "初始积分"],
      ["202601", "张小满", "女", 100],
      ["202602", "李远舟", "男", 100],
    ];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = [{ wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 10 }];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "学生名单");
    const data = XLSX.write(book, { bookType: "xlsx", type: "array" });
    downloadFile("班级宠物-学生导入模板.xlsx", new Blob([data], { type: "application/octet-stream" }));
  }

  function downloadExamTemplate() {
    const students = studentsInClass();
    const rows = [["学号", "姓名", "成绩"]];
    if (students.length) {
      students.forEach((s) => rows.push([s.studentNo, s.name, ""]));
    } else {
      rows.push(["202601", "张小满", 98]);
      rows.push(["202602", "李远舟", 105]);
    }
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = [{ wch: 14 }, { wch: 14 }, { wch: 10 }];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "考试成绩");
    const data = XLSX.write(book, { bookType: "xlsx", type: "array" });
    downloadFile("班级宠物-成绩导入模板.xlsx", new Blob([data], { type: "application/octet-stream" }));
    toast(students.length ? "模板已生成本班学生名单，填好成绩列后导入即可" : "模板已下载，示例数据可参考格式");
  }

  function createDemoClass() {
    const existing = state.classes.find((item) => item.name === DEMO_CLASS_NAME);
    if (existing) {
      state.settings.currentClassId = existing.id;
      ui.selectedStudentId = null;
      renderAll();
      toast("演示班已存在，已切换到该班级", "info");
      return false;
    }

    const klass = { id: uid("cls"), name: DEMO_CLASS_NAME, createdAt: new Date().toISOString() };
    state.classes.push(klass);
    state.settings.currentClassId = klass.id;
    ui.selectedStudentId = null;

    const students = DEMO_STUDENTS.map(([name, gender], index) => {
      const student = createStudent(klass.id, {
        studentNo: `2026${String(index + 1).padStart(3, "0")}`,
        name,
        gender,
      });
      student.pet = createPet(randomSpecies().id);
      addTransaction(student, 100, "新学期初始积分", "system");
      return student;
    });
    state.students.push(...students);
    renderAll();
    toast(`已生成 ${DEMO_STUDENTS.length} 名演示学生，全部随机领养宠物`);
    return true;
  }

  function normalizeHeader(value) {
    return String(value ?? "").replace(/[\s_-]/g, "").toLowerCase();
  }

  function pickField(row, names) {
    const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]));
    for (const name of names) {
      if (normalized[name] !== undefined && normalized[name] !== "") return normalized[name];
    }
    return "";
  }

  async function importExcel(file) {
    const klass = currentClass();
    if (!klass) {
      toast("请先创建并选择班级", "error");
      return;
    }
    try {
      const buffer = await file.arrayBuffer();
      const book = XLSX.read(buffer, { type: "array" });
      const sheetName = book.SheetNames[0];
      if (!sheetName) throw new Error("Excel 中没有工作表");
      const rows = XLSX.utils.sheet_to_json(book.Sheets[sheetName], { defval: "" });
      let added = 0;
      let updated = 0;

      rows.forEach((raw) => {
        const studentNo = String(pickField(raw, ["学号", "学生号", "编号", "no", "id"])).trim();
        const name = String(pickField(raw, ["姓名", "名字", "name"])).trim();
        if (!studentNo || !name) return;
        let gender = String(pickField(raw, ["性别", "gender"])).trim();
        gender = gender.startsWith("男") ? "男" : gender.startsWith("女") ? "女" : "其他";
        const rawPoints = pickField(raw, ["初始积分", "积分", "points"]);
        const points = rawPoints === "" ? undefined : Number(rawPoints);
        const existing = state.students.find((item) => item.classId === klass.id && item.studentNo === studentNo);
        if (existing) {
          existing.name = name;
          existing.gender = gender;
          updated += 1;
        } else {
          const student = ensureStudentShape(createStudent(klass.id, { studentNo, name, gender, points }));
          student.pet = createPet(randomSpecies("normal").id);
          state.students.push(student);
          added += 1;
        }
      });

      if (!added && !updated) {
        toast("没有识别到有效的学号和姓名", "error");
        return;
      }
      scheduleSave();
      renderAll();
      toast(`导入完成：新增 ${added} 人，更新 ${updated} 人`);
    } catch (error) {
      console.error(error);
      toast("Excel 解析失败，请检查文件格式", "error");
    }
  }

  async function importExamExcel(file) {
    const students = studentsInClass();
    if (!students.length) { toast("当前班级没有学生", "error"); return; }
    try {
      const buffer = await file.arrayBuffer();
      const book = XLSX.read(buffer, { type: "array" });
      const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: "" });
      let matched = 0;
      let missed = 0;
      rows.forEach((raw) => {
        const no = String(pickField(raw, ["学号", "学生号", "编号", "no", "id"])).trim();
        const name = String(pickField(raw, ["姓名", "名字", "name"])).trim();
        const scoreRaw = pickField(raw, ["成绩", "分数", "得分", "score"]);
        const score = Number(String(scoreRaw).trim());
        if (!Number.isFinite(score)) return;
        const target = students.find((s) => (no && s.studentNo === no) || (name && s.name === name));
        if (!target) { missed += 1; return; }
        const input = qs(`#examForm input[name="score_${target.id}"]`);
        if (input) {
          input.value = clamp(score, 0, 150);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        matched += 1;
      });
      if (!matched) { toast("没有匹配到任何学生，请确认表包含 学号/姓名/成绩 列", "error"); return; }
      toast(`成绩已填入：匹配 ${matched} 人${missed ? `，未匹配 ${missed} 行` : ""}，确认后点保存`);
    } catch (error) {
      console.error(error);
      toast("Excel 解析失败，请检查文件格式", "error");
    }
  }

  function buyItem(student, itemId) {
    const item = SHOP_MAP[itemId];
    if (!item) return;
    if (!student.pet) {
      toast("请先领养宠物，再购买商城道具", "error");
      return;
    }
    if (item.type === "evolution") {
      const currentSpecies = SPECIES_MAP[student.pet.speciesId];
      if (currentSpecies.rarity === "myth") {
        toast("当前宠物已经是神兽", "error");
        return;
      }
      if (!confirm("确定消耗 500 积分进行神兽进化吗？结果随机且不可撤销。")) return;
    }
    if (student.points < item.price) {
      toast("积分不足", "error");
      return;
    }
    if (item.type === "evolution") {
      const oldSpecies = SPECIES_MAP[student.pet.speciesId];
      const nextSpecies = randomSpecies("myth");
      if (!changePoints(student, -item.price, `神兽进化：${oldSpecies.name} → ${nextSpecies.name}`, "shop")) return;
      student.pet.speciesId = nextSpecies.id;
      student.pet.evolvedFrom = oldSpecies.id;
      student.pet.evolvedAt = new Date().toISOString();
      scheduleSave();
      renderView();
      toast(`进化成功！${student.name} 的宠物化为 ${nextSpecies.name}`);
      return;
    }
    if (!changePoints(student, -item.price, `购买 ${item.name}`, "shop")) return;
    if (item.type === "living") {
      const entry = student.pet.inventory.find((inv) => inv.itemId === item.id);
      if (entry) entry.qty += 1;
      else student.pet.inventory.push({ itemId: item.id, qty: 1 });
    } else {
      student.pet.equipment.push({ instanceId: uid("eq"), itemId: item.id, createdAt: new Date().toISOString() });
    }
    scheduleSave();
    renderView();
    toast(`已购买 ${item.name}`);
  }

  function useLivingItem(student, itemId) {
    const item = SHOP_MAP[itemId];
    const entry = student.pet.inventory.find((inv) => inv.itemId === itemId && inv.qty > 0);
    if (!item || !entry || item.type !== "living") return;
    if (itemId === "reset-scroll") {
      const refunded = allocatedPoints(student.pet);
      if (!refunded) { toast("当前没有已分配的加点"); return; }
      Object.keys(student.pet.stats).forEach((key) => { student.pet.stats[key] = 0; });
      ui.statDraft = null;
      entry.qty -= 1;
      student.pet.inventory = student.pet.inventory.filter((inv) => inv.qty > 0);
      scheduleSave();
      renderView();
      toast(`忘却卷轴生效，${refunded} 点属性已全部返还`);
      return;
    }
    Object.entries(item.effects).forEach(([key, value]) => {
      if (key === "xp") return;
      student.pet.base[key] = clamp(student.pet.base[key] + value, 0, 100);
    });
    entry.qty -= 1;
    student.pet.inventory = student.pet.inventory.filter((inv) => inv.qty > 0);
    student.pet.careCount += 1;
    if (item.effects.xp) {
      const events = gainPetXp(student.pet, item.effects.xp);
      announceLevelUp(student, events);
    }
    scheduleSave();
    renderView();
    toast(`已使用 ${item.name}`);
  }

  function skillChance(level) {
    return Math.min(35, 8 + (Number(level) || 1) * 3);
  }

  function trySkill(pet) {
    const moodFactor = 0.5 + (Number(pet.base?.mood) || 0) / 200; // 心情 100→1.0，心情 30→0.65
    return Math.random() * 100 < skillChance(pet.level) * moodFactor;
  }

  function speciesPlate(species, text) {
    const label = text ?? species.name;
    return species.rarity === "myth"
      ? `<span class="myth-plate">${esc(label)}</span>`
      : esc(label);
  }

  function titlePlate(text) {
    return `<span class="title-plate">${esc(text)}</span>`;
  }

  function petPlate(student) {
    const species = SPECIES_MAP[student.pet?.speciesId];
    if (!species) return esc(petName(student));
    return speciesPlate(species, petName(student));
  }

  function shortName(student) {
    return `${student.name}·${petName(student)}`;
  }

  function healFighter(fighter, pct, log, label) {
    const amount = Math.max(1, Math.round(fighter.maxHp * pct));
    fighter.hp = Math.min(fighter.maxHp, fighter.hp + amount);
    log.push(`${label}，回复 ${amount} 点生命（${fighter.hp}/${fighter.maxHp}）。`);
  }

  function snapshotOf(fighter) {
    return { hp: fighter.hp, maxHp: fighter.maxHp, shield: fighter.shield || 0, debuff: fighter.debuffNext || null };
  }

  function simulateBattle(a, b) {
    const statsA = effectiveStats(a.pet);
    const statsB = effectiveStats(b.pet);
    const maxA = petMaxHp(a.pet);
    const maxB = petMaxHp(b.pet);
    const fighterA = {
      student: a,
      stats: statsA,
      maxHp: maxA,
      hp: maxA,
      shield: SPECIES_MAP[a.pet.speciesId]?.id === "pixiu" ? Math.round(maxA * 0.06) : 0,
    };
    const fighterB = {
      student: b,
      stats: statsB,
      maxHp: maxB,
      hp: maxB,
      shield: SPECIES_MAP[b.pet.speciesId]?.id === "pixiu" ? Math.round(maxB * 0.06) : 0,
    };
    const log = [
      `⚔ 进攻方 ${shortName(a)} 上场，生命 ${fighterA.hp}/${fighterA.maxHp}${fighterA.shield ? `，护盾 ${fighterA.shield}` : ""}。`,
      `🛡 守擂方 ${shortName(b)} 上场，生命 ${fighterB.hp}/${fighterB.maxHp}${fighterB.shield ? `，护盾 ${fighterB.shield}` : ""}。`,
    ];
    if (SPECIES_MAP[a.pet.speciesId]?.id === "pixiu") log.push(`${a.name} 的被动「聚灵护盾」生效，获得 ${fighterA.shield} 点护盾。`);
    if (SPECIES_MAP[b.pet.speciesId]?.id === "pixiu") log.push(`${b.name} 的被动「聚灵护盾」生效，获得 ${fighterB.shield} 点护盾。`);
    let turn = 0;

    // 逐帧记录：每次 log.push 时自动抓取双方状态快照
    const frames = [];
    const rec = {
      push(line) {
        log.push(line);
        frames.push({ line, a: snapshotOf(fighterA), b: snapshotOf(fighterB) });
      },
    };
    log.forEach((line) => frames.push({ line, a: snapshotOf(fighterA), b: snapshotOf(fighterB) }));

    while (fighterA.hp > 0 && fighterB.hp > 0 && turn < 100) {
      turn += 1;
      const first = fighterA.stats.speed === fighterB.stats.speed ? (Math.random() < 0.5 ? fighterA : fighterB) : fighterA.stats.speed > fighterB.stats.speed ? fighterA : fighterB;
      const second = first === fighterA ? fighterB : fighterA;
      attack(first, second, rec, turn);
      if (second.hp <= 0) break;
      attack(second, first, rec, turn);

      const faster = fighterA.stats.speed > fighterB.stats.speed ? fighterA : fighterB.stats.speed > fighterA.stats.speed ? fighterB : null;
      if (faster) {
        const slower = faster === fighterA ? fighterB : fighterA;
        const speedDiff = faster.stats.speed - slower.stats.speed;
        const pursuitChance = clamp(speedDiff * 6, 8, 60); // 每快 1 点 +6%，保底 8%，上限 60%
        if (speedDiff > 0 && Math.random() < pursuitChance) {
          attack(faster, slower, rec, turn, true);
        }
      }

      // 回合结束：苍龙被动「龙威」回血
      [fighterA, fighterB].forEach((fighter) => {
        if (fighter.hp > 0 && SPECIES_MAP[fighter.student.pet.speciesId]?.id === "dragon") {
          healFighter(fighter, 0.02, rec, `【回合结束】💚 ${shortName(fighter.student)} 的被动「龙威」生效`);
        }
      });
    }

    if (fighterA.hp <= 0 && fighterB.hp <= 0) {
      fighterA.hp = 1;
      fighterB.hp = 0;
      log.push("双方同时倒地，意志更坚定的一方险胜！");
    } else if (fighterA.hp > 0 && fighterB.hp > 0) {
      if (fighterA.hp / fighterA.maxHp >= fighterB.hp / fighterB.maxHp) fighterB.hp = 0;
      else fighterA.hp = 0;
      log.push("裁判回合结束，剩余生命比例更高的一方获胜。");
    }
    const winner = fighterA.hp > 0 ? a : b;
    const loser = winner === a ? b : a;
    log.push(`${winner.name} 的${petName(winner)}获胜！`);
    return { winner, loser, log, frames };
  }

  function attack(attacker, defender, log, turn, extra = false) {
    const petA = attacker.student.pet;
    const speciesA = SPECIES_MAP[petA.speciesId];
    const petD = defender.student.pet;
    const speciesD = SPECIES_MAP[petD.speciesId];
    const who = shortName(attacker.student);
    const foe = shortName(defender.student);

    // 进攻方上回合被附加的减益（威压 / 咆哮 / 寒冷）
    if (attacker.debuffNext) {
      log.push(`【第 ${turn} 回合】⬇ ${who} 受减益影响，本次攻击伤害降低。`);
      attacker.dmgFactor = attacker.debuffNext;
      attacker.debuffNext = null;
    }

    // 防守方技能：完全闪避
    if (speciesD?.id === "rabbit" && !extra && trySkill(petD)) {
      log.push(`【第 ${turn} 回合】${foe} 触发「月影闪避」，完全躲开了 ${who} 的攻击！`);
      return;
    }

    const satietyFactor = 0.72 + petA.base.satiety * 0.0038; // 饱食 100→1.10，饱食 30→0.83
    const baseDamage = (7 + attacker.stats.strength * 0.72) * satietyFactor * (attacker.dmgFactor || 1);
    attacker.dmgFactor = null;
    let mitigation = 100 / (100 + defender.stats.defense * 2.25);
    let mult = 1;
    let forceCrit = false;
    let ignoreDef = false;
    const sid = speciesA?.id;
    const skillOn = !extra && trySkill(petA);

    if (skillOn) {
      if (sid === "cat") forceCrit = true;
      else if (sid === "corgi") ignoreDef = true;
      else if (sid === "horse") mult = 1.3;
      else if (sid === "duck") mult = 1.1;
      else if (sid === "dragon") mult = 1.6;
      else if (sid === "tiger") mult = 1.4;
      else if (sid === "pixiu") mult = 1.2;
      log.push(`【第 ${turn} 回合】⚡ ${who} 触发技能「${speciesA.skill.name}」！`);
    }

    const variance = 0.9 + Math.random() * 0.24;
    let critChance = clamp(4 + attacker.stats.focus * 1.4, 0, 35);
    const isCrit = forceCrit || Math.random() * 100 < critChance;
    let damage = Math.max(3, Math.round(baseDamage * (ignoreDef ? 1 : mitigation) * mult * variance * (isCrit ? 1.65 : 1)));
    if (speciesD?.id === "cow") damage = Math.max(1, Math.round(damage * 0.94)); // 霜狼被动「凛冬庇护」

    // 防守方减伤技能
    if (speciesD?.id === "alpaca" && !extra && trySkill(petD)) {
      damage = Math.max(1, Math.round(damage * 0.5));
      log.push(`【第 ${turn} 回合】🛡 ${foe} 触发「云雾护体」，伤害减半！`);
    } else if (speciesD?.id === "sheep" && !extra && trySkill(petD)) {
      damage = Math.max(1, Math.round(damage * 0.4));
      log.push(`【第 ${turn} 回合】🛡 ${foe} 触发「云绒缓冲」，抵消了大部分伤害！`);
    }
    // 凤凰被动「涅槃余温」
    if (speciesD?.id === "phoenix" && defender.hp / defender.maxHp < 0.3) {
      damage = Math.round(damage * 0.85);
      log.push(`【第 ${turn} 回合】🛡 ${foe} 的被动「涅槃余温」生效，伤害 -15%。`);
    }

    // 貔貅被动护盾吸收
    if (defender.shield > 0) {
      const absorbed = Math.min(defender.shield, damage);
      defender.shield -= absorbed;
      damage -= absorbed;
      log.push(`【第 ${turn} 回合】🛡 ${foe} 的护盾吸收 ${absorbed} 点伤害${defender.shield ? "" : "，护盾破碎"}。`);
    }

    defender.hp = Math.max(0, defender.hp - damage);
    log.push(
      `【第 ${turn} 回合${extra ? " · 追击" : ""}】${who} ➜ ${foe}：造成 ${damage} 点伤害${isCrit ? "（会心一击）" : ""}${ignoreDef ? "（无视防御）" : ""}，${foe} 剩余 ${defender.hp}/${defender.maxHp}。`
    );

    if (defender.hp <= 0) return;

    // 技能后续效果
    if (skillOn) {
      if (sid === "dog") {
        const extraDamage = Math.max(1, Math.round(damage * 0.4));
        defender.hp = Math.max(0, defender.hp - extraDamage);
        log.push(`【第 ${turn} 回合】💥 ${who} 连咬追加 ${extraDamage} 点伤害，${foe} 剩余 ${defender.hp}/${defender.maxHp}。`);
      } else if (sid === "raccoon") {
        const burn = Math.max(1, Math.round(damage * 0.15));
        defender.hp = Math.max(0, defender.hp - burn);
        log.push(`【第 ${turn} 回合】🔥 灼烧对 ${foe} 造成 ${burn} 点真实伤害，剩余 ${defender.hp}/${defender.maxHp}。`);
      } else if (sid === "hamster") {
        healFighter(attacker, 0.08, log, `${who}的「储备回春」生效`);
      } else if (sid === "duck") {
        healFighter(attacker, 0.05, log, `${who}的「潮鸣涌动」生效`);
      } else if (sid === "phoenix") {
        healFighter(attacker, 0.12, log, `${who}的「浴火重生」生效`);
      } else if (sid === "pixiu") {
        const steal = Math.max(1, Math.round(damage * 0.3));
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + steal);
        log.push(`【第 ${turn} 回合】💚 ${who} 吸取 ${steal} 点生命，剩余 ${attacker.hp}/${attacker.maxHp}。`);
      } else if (sid === "pig") {
        defender.debuffNext = 0.8;
        log.push(`【第 ${turn} 回合】⬇ ${foe} 被「金鬃威压」压制，其下次攻击伤害 -20%。`);
      } else if (sid === "cow") {
        defender.debuffNext = 0.75;
        log.push(`【第 ${turn} 回合】❄ ${foe} 被寒冷侵袭，其下次攻击伤害 -25%。`);
      } else if (sid === "tiger") {
        defender.debuffNext = 0.85;
        log.push(`【第 ${turn} 回合】⬇ ${foe} 被「白虎咆哮」震慑，其下次攻击伤害 -15%。`);
      }
    }
  }

  function runBattle(aId, bId) {
    const a = studentById(aId);
    const b = studentById(bId);
    if (!a || !b || a.id === b.id || !a.pet || !b.pet) {
      toast("请选择两名不同且已领养宠物的学生", "error");
      return;
    }
    if (a.points < 10 || b.points < 10) {
      toast("双方积分都必须不低于 10", "error");
      return;
    }
    if (a.pet.base.health < 30 || b.pet.base.health < 30) {
      toast("宠物健康低于 30，禁止战斗，请先恢复健康", "error");
      return;
    }
    changePoints(a, -10, "开启 PVP 消耗", "battle");
    changePoints(b, -10, "开启 PVP 消耗", "battle");
    const result = simulateBattle(a, b);
    const winner = result.winner;
    const loser = result.loser;
    awardPoints(winner, 20, "PVP 胜利奖励", "battle", false);

    winner.battles.wins += 1;
    winner.battles.total += 1;
    loser.battles.losses += 1;
    loser.battles.total += 1;
    winner.pet.battleCount += 1;
    loser.pet.battleCount += 1;

    [a, b].forEach((student) => {
      const pet = student.pet;
      pet.base.satiety = clamp(pet.base.satiety - 5, 0, 100);
      if ((pet.base.satiety < 30 || pet.base.mood < 30) && Math.random() < 0.4) {
        pet.base.health = clamp(pet.base.health - 5, 0, 100);
      }
    });
    winner.pet.base.mood = clamp(winner.pet.base.mood + 5, 0, 100);
    loser.pet.base.mood = clamp(loser.pet.base.mood - 5, 0, 100);

    const record = {
      id: uid("battle"),
      classId: state.settings.currentClassId,
      aId: a.id,
      bId: b.id,
      winnerId: winner.id,
      log: result.log,
      frames: result.frames,
      createdAt: new Date().toISOString(),
    };
    state.battles.push(record);
    state.battles = state.battles.slice(-30);
    ui.lastBattleId = record.id;
    ui.battleA = a.id;
    ui.battleB = b.id;
    scheduleSave();
    startPlayback(result.frames);
    renderView();
    toast(`${winner.name} 获胜，奖励 20 积分`);
  }

  function handleAction(button) {
    const action = button.dataset.action;
    const id = button.dataset.id;

    if (action === "battle-tab") {
      stopPlayback();
      clearTimeout(champAnimTimer);
      champAnimTimer = null;
      ui.battleTab = button.dataset.value;
      renderView();
      return;
    }
    if (action === "champ-tab") {
      clearTimeout(champAnimTimer);
      champAnimTimer = null;
      ui.champTab = button.dataset.value;
      const list = classTournaments().filter((item) => item.kind === (ui.champTab === "class" ? "class" : "grade"));
      ui.activeTournamentId = list[list.length - 1]?.id || null;
      renderView();
      return;
    }
    if (action === "champ-create-class" || action === "champ-create-grade") {
      ui.champCreate = action === "champ-create-class" ? "class" : "grade";
      renderView();
      return;
    }
    if (action === "champ-create-cancel") {
      ui.champCreate = null;
      renderView();
      return;
    }
    if (action === "champ-view") {
      ui.activeTournamentId = id;
      renderView();
      return;
    }
    if (action === "champ-fight" || action === "champ-round") {
      const t = tournamentById(id);
      if (!t) return;
      if (action === "champ-fight") {
        const all = action === "champ-fight" ? [...t.matches, ...t.knockout.flatMap((r) => r.matches)] : [];
        const m = all.find((item) => item.id === button.dataset.match);
        if (m) fightTournamentMatch(t, m);
        if (t.phase === "bracket" && t.knockout[t.knockout.length - 1].matches.every((x) => x.winnerId)) {
          advanceKnockout(t);
          toast(t.phase === "done" ? "决赛结束！" : "本轮结束，下一轮对阵已自动生成");
        }
      } else if (t.phase === "group") {
        clearTimeout(champAnimTimer);
        runChampGroupAnimation(t);
        return;
      } else {
        const pool = t.knockout[t.knockout.length - 1].matches;
        pool.forEach((m) => fightTournamentMatch(t, m));
        if (t.phase === "bracket" && pool.every((m) => m.winnerId)) {
          advanceKnockout(t);
          toast(t.phase === "done" ? "决赛结束！" : "本轮结束，下一轮对阵已自动生成");
        }
      }
      scheduleSave();
      renderView();
      return;
    }
    if (action === "champ-ko") {
      const t = tournamentById(id);
      if (!t) return;
      startKnockout(t);
      scheduleSave();
      renderView();
      toast("淘汰赛对阵已生成");
      return;
    }
    if (action === "champ-ko-next") {
      const t = tournamentById(id);
      if (!t) return;
      advanceKnockout(t);
      scheduleSave();
      renderView();
      return;
    }
    if (action === "champ-classes") {
      const t = tournamentById(id);
      if (!t) return;
      const names = (t.classNames || t.classIds.map((cid) => state.classes.find((c) => c.id === cid)?.name || "?"));
      alert(`${t.name}（${formatTime(t.createdAt)}）\n参赛班级（${names.length} 个）：\n${names.join("、")}`);
      return;
    }
    if (action === "champ-detail") {
      ui.champMatchView = { tid: id, mid: button.dataset.match };
      renderView();
      const t2 = tournamentById(id);
      const pool2 = t2 ? [...t2.matches, ...(t2.knockout || []).flatMap((r) => r.matches)] : [];
      const m2 = pool2.find((item) => item.id === button.dataset.match);
      if (m2 && !m2.log && m2.logPruned) {
        loadArchivedLog(`${id}:${m2.id}`).then((log) => {
          if (log && ui.champMatchView && ui.champMatchView.mid === m2.id) {
            m2.log = log;
            m2.logPruned = false;
            renderView();
          }
        });
      }
      return;
    }
    if (action === "champ-detail-close") {
      ui.champMatchView = null;
      renderView();
      return;
    }
    if (action === "grade-class-toggle") {
      const cid = id;
      ui.gradeClassIds = button.checked ? [...ui.gradeClassIds, cid] : ui.gradeClassIds.filter((item) => item !== cid);
      renderView();
      return;
    }
    if (action === "download-template") return downloadTemplate();
    if (action === "create-demo-class") {
      if (createDemoClass()) scheduleSave();
      return;
    }
    if (action === "import-excel") return qs("#importExcelInput").click();
    if (action === "download-exam-template") return downloadExamTemplate();
    if (action === "import-exam-excel") return qs("#examExcelInput").click();
    if (action === "open-student") {
      ui.selectedStudentId = id;
      state.settings.view = "pets";
      scheduleSave();
      return renderAll();
    }
    if (action === "delete-student") {
      const student = studentById(id);
      if (!student || !confirm(`确定删除 ${student.name}？宠物与积分记录会一起删除。`)) return;
      state.students = state.students.filter((item) => item.id !== id);
      state.battles = state.battles.filter((item) => item.aId !== id && item.bId !== id);
      if (ui.selectedStudentId === id) ui.selectedStudentId = null;
      scheduleSave();
      renderAll();
      toast("学生已删除");
      return;
    }
    if (action === "delete-class") {
      const klass = currentClass();
      if (!klass || !confirm(`确定删除 ${klass.name}？该班学生与战斗记录会一起删除。`)) return;
      state.classes = state.classes.filter((item) => item.id !== klass.id);
      state.students = state.students.filter((item) => item.classId !== klass.id);
      state.battles = state.battles.filter((item) => item.classId !== klass.id);
      state.settings.currentClassId = state.classes[0]?.id || null;
      ui.selectedStudentId = null;
      scheduleSave();
      renderAll();
      toast("班级已删除");
      return;
    }
    if (action === "daily-settlement") {
      const students = studentsInClass().filter((item) => item.pet);
      students.forEach((student) => {
        const pet = student.pet;
        pet.base.satiety = clamp(pet.base.satiety - 12, 5, 100);
        pet.base.mood = clamp(pet.base.mood - 8, 5, 100);
        if (pet.base.satiety < 35) pet.base.health = clamp(pet.base.health - 5, 5, 100);
      });
      scheduleSave();
      renderView();
      toast(`已结算 ${students.length} 只宠物的日常状态`);
      return;
    }
    if (action === "choose-species") {
      const student = selectedStudent();
      if (!student) return;
      if (student.pet && !confirm("该学生已有宠物，确定替换吗？原宠物加点、装备和物资会被清空。")) return;
      student.pet = createPet(id);
      ui.selectedStudentId = student.id;
      scheduleSave();
      renderView();
      toast(`${student.name} 领养了 ${SPECIES_MAP[id].name}`);
      return;
    }
    if (action === "stat-inc" || action === "stat-dec") {
      const student = selectedStudent();
      if (!student?.pet) return;
      const key = button.dataset.stat;
      if (!ui.statDraft || ui.statDraft.studentId !== student.id) ui.statDraft = { studentId: student.id, points: {} };
      const points = ui.statDraft.points;
      const draftTotal = Object.values(points).reduce((sum, v) => sum + (Number(v) || 0), 0);
      if (action === "stat-inc") {
        if (availablePoints(student.pet) - draftTotal <= 0) return;
        points[key] = (Number(points[key]) || 0) + 1;
      } else if ((Number(points[key]) || 0) > 0) {
        points[key] -= 1;
        if (!points[key]) delete points[key];
      }
      renderView();
      return;
    }
    if (action === "stat-reset") {
      ui.statDraft = null;
      renderView();
      return;
    }
    if (action === "stat-confirm") {
      const student = selectedStudent();
      if (!student?.pet || !ui.statDraft || ui.statDraft.studentId !== student.id) return;
      const applied = Object.values(ui.statDraft.points).reduce((sum, v) => sum + (Number(v) || 0), 0);
      Object.entries(ui.statDraft.points).forEach(([key, value]) => {
        student.pet.stats[key] = (Number(student.pet.stats[key]) || 0) + (Number(value) || 0);
      });
      ui.statDraft = null;
      scheduleSave();
      renderView();
      toast(`已确认加点，共分配 ${applied} 点`);
      return;
    }
    if (action === "pet-draw") {
      ui.petDraw = id;
      renderView();
      return;
    }
    if (action === "pet-draw-close") {
      ui.petDraw = null;
      renderView();
      return;
    }
    if (action === "pet-draw-roll") {
      const student = studentById(id);
      if (!student || student.drawUsed) return;
      const myth = Math.random() < 0.05;
      const sp = randomSpecies(myth ? "myth" : "normal");
      student.pet = createPet(sp.id);
      student.drawUsed = true;
      ui.petDraw = null;
      scheduleSave();
      renderView();
      toast(myth ? `🎉 运气爆棚！${student.name} 抽到了神兽「${sp.name}」！` : `${student.name} 重新抽取获得「${sp.name}」`);
      return;
    }
    if (action === "pet-draw-pick") {
      const area = qs("#drawPickArea");
      if (area) area.hidden = !area.hidden;
      return;
    }
    if (action === "pet-draw-choose") {
      const student = studentById(id);
      const sp = SPECIES_MAP[button.dataset.species];
      if (!student || student.drawUsed || !sp) return;
      student.pet = createPet(sp.id);
      student.drawUsed = true;
      ui.petDraw = null;
      scheduleSave();
      renderView();
      toast(`${student.name} 自选了宠物「${sp.name}」`);
      return;
    }
    if (action === "use-item") {
      const student = selectedStudent();
      if (student?.pet) useLivingItem(student, id);
      return;
    }
    if (action === "page") {
      const key = button.dataset.key;
      const page = Number(button.dataset.page) || 1;
      // 保存成绩录入表当前已填内容，避免翻页丢失
      document.querySelectorAll("#examForm input[name^=score_]").forEach((input) => {
        ui.examDraft[input.name.replace("score_", "")] = input.value;
      });
      ui.pages[key] = page;
      renderView();
      // 定位到该分页所在面板的顶部，而不是页面顶部
      const panel = [...document.querySelectorAll(".pager")].find((el) => el.querySelector(`[data-key="${key}"]`));
      const target = panel?.closest("section, .panel") || panel;
      if (target) {
        const y = target.getBoundingClientRect().top + window.scrollY - 70;
        window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
      }
      return;
    }
    if (action === "title-equip") {
      const student = selectedStudent();
      const pet = student?.pet;
      const t = pet?.titles?.find((item) => item.id === id);
      if (!t) return;
      if (t.expiresAt && new Date(t.expiresAt) <= new Date()) { toast("该称号已过期", "error"); return; }
      pet.equipped.title = t.id;
      student.title = t.name;
      scheduleSave();
      renderView();
      toast(`已佩戴称号「${t.name}」，全属性 +1`);
      return;
    }
    if (action === "title-unequip") {
      const student = selectedStudent();
      const pet = student?.pet;
      if (!pet) return;
      pet.equipped.title = null;
      student.title = null;
      scheduleSave();
      renderView();
      toast("已卸下称号");
      return;
    }
    if (action === "equip") {
      const student = selectedStudent();
      if (!student?.pet) return;
      const item = student.pet.equipment.find((entry) => entry.instanceId === id);
      const def = item ? SHOP_MAP[item.itemId] : null;
      if (def) {
        student.pet.equipped[def.slot] = item.instanceId;
        scheduleSave();
        renderView();
      }
      return;
    }
    if (action === "unequip") {
      const student = selectedStudent();
      if (!student?.pet) return;
      student.pet.equipped[button.dataset.slot] = null;
      scheduleSave();
      renderView();
      return;
    }
    if (action === "buy") {
      const student = selectedStudent();
      if (student) buyItem(student, id);
      return;
    }
    if (action === "dex-tab") {
      ui.dexTab = button.dataset.value || "pets";
      renderView();
      return;
    }
    if (action === "dex-detail") {
      ui.dexSpeciesId = id;
      renderView();
      return;
    }
    if (action === "dex-close") {
      ui.dexSpeciesId = null;
      renderView();
      return;
    }
    if (action === "pet-tab") {
      ui.petTab = button.dataset.value || "train";
      renderView();
      return;
    }
    if (action === "replay-battle") {
      const record = state.battles.find((item) => item.id === id);
      if (record?.frames?.length) {
        ui.lastBattleId = record.id;
        startPlayback(record.frames);
        renderView();
      } else {
        toast("该场战斗没有可回放的帧数据", "error");
      }
      return;
    }
    if (action === "rank-scope") {
      ui.rankScope = button.dataset.value;
      renderView();
      return;
    }
    if (action === "rank-metric") {
      ui.rankMetric = button.dataset.value;
      renderView();
    }
  }

  function handleSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    const data = new FormData(form);

    if (form.id === "createClassForm") {
      const name = String(data.get("name") || "").trim();
      if (!name) return;
      if (state.classes.some((item) => item.name === name)) {
        toast("已有同名班级", "error");
        return;
      }
      const klass = { id: uid("cls"), name, createdAt: new Date().toISOString() };
      state.classes.push(klass);
      state.settings.currentClassId = klass.id;
      ui.selectedStudentId = null;
      form.reset();
      scheduleSave();
      renderAll();
      toast(`班级 ${name} 已创建`);
      return;
    }

    if (form.id === "createStudentForm") {
      const klass = currentClass();
      if (!klass) return;
      const studentNo = String(data.get("studentNo") || "").trim();
      const name = String(data.get("name") || "").trim();
      const gender = String(data.get("gender") || "其他");
      if (!studentNo || !name) return;
      if (state.students.some((item) => item.classId === klass.id && item.studentNo === studentNo)) {
        toast("该学号已存在", "error");
        return;
      }
      state.students.push(ensureStudentShape(createStudent(klass.id, { studentNo, name, gender })));
      form.reset();
      scheduleSave();
      renderView();
      toast("学生已添加");
      return;
    }

    if (form.id === "selectStudentForm") {
      const id = String(data.get("studentId") || "");
      if (id) {
        ui.selectedStudentId = id;
        renderView();
      }
      return;
    }

    if (form.id === "examForm") {
      const title = String(data.get("title") || "").trim();
      const students = studentsInClass();
      const entries = [];
      let count = 0;
      let points = 0;
      students.forEach((student) => {
        const rawFromForm = data.get(`score_${student.id}`);
        const raw = rawFromForm === null ? (ui.examDraft[student.id] ?? "") : rawFromForm;
        if (raw === null || raw === "") return;
        const score = clamp(Number(raw), 0, 150);
        const gained = scoreToPoints(score);
        const record = {
          id: uid("score"),
          title,
          score,
          points: gained,
          createdAt: new Date().toISOString(),
        };
        student.scores.unshift(record);
        student.scores = student.scores.slice(0, 100);
        awardPoints(student, gained, `${title}：${score} 分`, "score", true);
        entries.push({ studentId: student.id, studentNo: student.studentNo, name: student.name, score, points: gained });
        count += 1;
        points += gained;
      });
      if (!count) {
        toast("至少填写一名学生的成绩", "error");
        return;
      }
      state.exams = state.exams || [];
      state.exams.push({
        id: uid("exam"),
        title,
        createdAt: new Date().toISOString(),
        classId: state.settings.currentClassId,
        avgScore: Math.round(entries.reduce((s, e) => s + e.score, 0) / entries.length),
        totalPoints: points,
        entries,
      });
      state.exams = state.exams.slice(-50);
      scheduleSave();
      renderView();
      ui.examDraft = {};
      toast(`${title} 已录入 ${count} 人，共发放 ${points} 积分`);
      return;
    }

    if (form.id === "teacherPointsForm") {
      const student = studentById(String(data.get("studentId") || ""));
      const amount = Math.round(Number(data.get("amount")));
      const reason = String(data.get("reason") || "").trim();
      if (!student || !amount || !reason) return;
      if (!awardPoints(student, amount, reason, "teacher", amount > 0)) {
        toast("扣分后积分不能为负", "error");
        return;
      }
      scheduleSave();
      renderView();
      toast(`${student.name} ${amount >= 0 ? "获得" : "扣除"} ${Math.abs(amount)} 积分`);
      return;
    }

    if (form.id === "battleForm") {
      runBattle(String(data.get("a")), String(data.get("b")));
      return;
    }
  }

  function exportState() {
    const payload = JSON.stringify(state, null, 2);
    const klass = currentClass();
    const suffix = klass ? klass.name : "全部数据";
    downloadFile(`班级宠物备份-${suffix}-${new Date().toISOString().slice(0, 10)}.json`, new Blob([payload], { type: "application/json" }));
    toast("备份文件已导出");
  }

  async function importStateFile(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.classes) || !Array.isArray(parsed.students)) {
        throw new Error("格式不正确");
      }
      if (!confirm("导入会覆盖当前本机全部班级数据，确定继续吗？")) return;
      state = migrateState(parsed);
      ui = { ...ui, selectedStudentId: null, battleA: null, battleB: null, lastBattleId: null };
      persistState({ backup: true });
      renderAll();
      toast("数据恢复完成");
    } catch (error) {
      console.error(error);
      toast(error.message || "JSON 导入失败", "error");
    }
  }

  // ===== 本地文件同步（文件系统访问 API，Chrome/Edge 支持） =====
  let fileHandle = null;

  function idbPutHandle(handle) {
    return openArchive().then((db) => new Promise((resolve) => {
      try {
        const tx = db.transaction("handles", "readwrite");
        tx.objectStore("handles").put(handle, "syncFile");
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (_e) { resolve(false); }
    })).catch(() => false);
  }

  function idbGetHandle() {
    return openArchive().then((db) => new Promise((resolve) => {
      try {
        const req = db.transaction("handles", "readonly").objectStore("handles").get("syncFile");
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (_e) { resolve(null); }
    })).catch(() => null);
  }

  async function bindSyncFile() {
    if (!window.showSaveFilePicker) { toast("当前浏览器不支持文件系统访问 API，请使用 Chrome/Edge，或用「备份/恢复」手动导出 JSON", "error"); return; }
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: "class-pet-data.json",
        types: [{ description: "班级宠物数据", accept: { "application/json": [".json"] } }],
      });
      fileHandle = handle;
      await idbPutHandle(handle);
      await writeSyncFile();
      updateFileSyncStatus();
      toast("已绑定本地文件，之后每次保存都会自动写入该文件");
    } catch (error) {
      if (error && error.name !== "AbortError") toast("绑定失败：" + error.message, "error");
    }
  }

  async function writeSyncFile() {
    if (!fileHandle) return;
    try {
      if ((await fileHandle.queryPermission({ mode: "readwrite" })) !== "granted") return;
      const writable = await fileHandle.createWritable();
      await writable.write(stateFingerprint());
      await writable.close();
    } catch (_error) { /* 下次再试 */ }
  }

  async function restoreSyncFile() {
    if (!fileHandle) return false;
    try {
      if ((await fileHandle.queryPermission({ mode: "readwrite" })) !== "granted") return false;
      const file = await fileHandle.getFile();
      const text = await file.text();
      if (!text) return false;
      state = migrateState(JSON.parse(text));
      toast("已从同步文件恢复数据");
      return true;
    } catch (_error) { return false; }
  }

  function updateFileSyncStatus() {
    const btn = qs("#fileSyncBtn");
    if (btn) btn.innerHTML = fileHandle ? `<i data-lucide="file-check-2"></i>文件同步中` : `<i data-lucide="file-json"></i>文件同步`;
    refreshIcons();
  }

  function bindGlobalEvents() {
    qsa(".nav-item").forEach((button) => {
      button.addEventListener("click", () => {
        stopPlayback();
        state.settings.view = button.dataset.view;
        scheduleSave();
        renderAll();
      });
    });

    qs("#classSelect").addEventListener("change", (event) => {
      stopPlayback();
      state.settings.currentClassId = event.target.value || null;
      ui.selectedStudentId = null;
      ui.battleA = null;
      ui.battleB = null;
      ui.lastBattleId = null;
      scheduleSave();
      renderView();
    });

    qs("#fileSyncBtn").addEventListener("click", bindSyncFile);
    idbGetHandle().then((handle) => { if (handle) { fileHandle = handle; updateFileSyncStatus(); } });
    qs("#exportStateBtn").addEventListener("click", exportState);
    qs("#importStateBtn").addEventListener("click", () => qs("#importStateInput").click());
    qs("#importStateInput").addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (file) await importStateFile(file);
      event.target.value = "";
    });
    qs("#resetStateBtn").addEventListener("click", () => {
      if (!confirm("确定清空本机所有班级、学生、宠物和记录吗？此操作不可撤销。")) return;
      state = createState();
      ui = { selectedStudentId: null, petTab: "train", dexTab: "pets", rankScope: "class", rankMetric: "level", battleTab: "pvp", champTab: "class", battleA: null, battleB: null, lastBattleId: null, activeTournamentId: null, gradeClassIds: [], champMatchView: null, champCreate: null };
      localStorage.removeItem(BACKUP_KEY);
      lastBackupAt = null;
      lastBackupFingerprint = "";
      persistState({ backup: true });
      renderAll();
      toast("本机数据已清空");
    });
    qs("#importExcelInput").addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (file) await importExcel(file);
      event.target.value = "";
    });
    document.addEventListener("change", async (event) => {
      if (event.target instanceof HTMLInputElement && event.target.id === "examExcelInput") {
        const file = event.target.files?.[0];
        if (file) await importExamExcel(file);
        event.target.value = "";
      }
    });

    document.addEventListener("input", (event) => {
      if (event.target instanceof HTMLInputElement && event.target.id === "examSearch") {
        ui.examQuery = event.target.value;
        const q = event.target.value.trim().toLowerCase();
        const table = event.target.closest("form")?.querySelector("table");
        table?.querySelectorAll("tbody tr").forEach((tr) => {
          const no = tr.children[0]?.textContent.trim().toLowerCase() || "";
          const name = tr.children[1]?.textContent.trim().toLowerCase() || "";
          tr.style.display = !q || no.includes(q) || name.includes(q) ? "" : "none";
        });
        return;
      }
      if (event.target instanceof HTMLInputElement && event.target.id === "studentSearch") {
        // 不重渲染，直接过滤表格行，避免打断输入法/焦点
        ui.studentQuery = event.target.value;
        const q = event.target.value.trim().toLowerCase();
        const rows = document.querySelectorAll("#view table tbody tr");
        let any = false;
        rows.forEach((tr) => {
          const no = tr.children[1]?.textContent.trim().toLowerCase() || "";
          const name = tr.children[0]?.textContent.trim().toLowerCase() || "";
          const hit = !q || no.includes(q) || name.includes(q);
          tr.style.display = hit ? "" : "none";
          if (hit) any = true;
        });
        return;
      }
      if (event.target instanceof HTMLInputElement && event.target.id === "champTitle") {
        const preview = qs("#titlePreviewText");
        const value = event.target.value.trim();
        if (preview) preview.textContent = value.length >= 2 ? value : "至少 2 个字";
      }
    });
    document.addEventListener("submit", (event) => {
      if (event.target instanceof HTMLFormElement && event.target.id === "champCreateForm") {
        event.preventDefault();
        const form = event.target;
        const title = String(form.title.value || "").trim();
        if (title.length < 2) { toast("头衔至少 2 个字", "error"); return; }
        const tiers = {};
        [["r1", "r1"], ["r2", "r2"], ["r3", "r3"], ["r4", "r4"], ["r5_8", "r5_8"], ["r9_16", "r9_16"], ["r17", "r17"]].forEach(([_, key]) => {
          tiers[key] = Math.max(0, Math.floor(Number(form[key]?.value) || 0));
        });
        ui.champCreate = null;
        if (ui.champTab === "grade") {
          if (ongoingGradeTournament()) { toast("已有进行中的武道大会，须先完赛", "error"); return; }
          createGradeTournament({ title, tiers });
        } else {
          if (ongoingClassTournament()) { toast("本班已有进行中的班级赛，须先完赛", "error"); return; }
          createClassTournament({ title, tiers });
        }
      }
    });
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (button instanceof HTMLButtonElement) {
        // 点击弹层遮罩本身才关闭（点内容区不关）
        if ((button.dataset.action === "dex-close" || button.dataset.action === "champ-detail-close" || button.dataset.action === "champ-create-cancel") && event.target !== button && !button.classList.contains("modal-close")) return;
        handleAction(button);
      } else if (button instanceof HTMLInputElement && button.type === "checkbox" && button.dataset.action) {
        handleAction(button);
      }
    });
    document.addEventListener("change", (event) => {
      const target = event.target;
      if (target instanceof HTMLSelectElement && target.closest("#battleForm") && (target.name === "a" || target.name === "b")) {
        stopPlayback();
        ui[target.name === "a" ? "battleA" : "battleB"] = target.value;
        renderView();
        return;
      }
      const selectorForm = target instanceof HTMLSelectElement ? target.closest("#selectStudentForm") : null;
      if (selectorForm && target.name === "studentId" && target.value) {
        ui.selectedStudentId = target.value;
        renderView();
      }
    });
    document.addEventListener("submit", handleSubmit);
    window.addEventListener("beforeunload", () => persistState());
  }

  function init() {
    loadState();
    const shouldSeedDemo = !state.classes.length;
    if (shouldSeedDemo) createDemoClass();
    renderAll();
    bindGlobalEvents();
    setSaveStatus("已保存");
    if (shouldSeedDemo) persistState({ backup: true });
    setInterval(() => persistState({ backup: true }), SAVE_INTERVAL);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
