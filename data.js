(function () {
  "use strict";

  const SPECIES = [
    { id: "cat", name: "夜刃猫", rarity: "normal", asset: "./pets/tabby-cat", desc: "贴地潜行的锋利猎手，出手安静果断。" , skill: { name: "影袭", desc: "触发时本次攻击必定会心" } },
    { id: "dog", name: "疾风柴犬", rarity: "normal", asset: "./pets/shiba", desc: "冲刺型前锋，擅长撕开对手防线。" , skill: { name: "疾风连咬", desc: "触发时追加一次 40% 伤害" } },
    { id: "rabbit", name: "月影兔", rarity: "normal", asset: "./pets/lop-rabbit", desc: "短距折返极快，捕捉战机敏锐。" , skill: { name: "月影闪避", desc: "触发时完全闪避本回合受到的攻击" } },
    { id: "hamster", name: "星仓鼠", rarity: "normal", asset: "./pets/hamster", desc: "小型持久战专家，资源管理出色。" , skill: { name: "储备回春", desc: "触发时回复自身 8% 最大生命" } },
    { id: "raccoon", name: "绯焰狸", rarity: "normal", asset: "./pets/red-panda", desc: "焰色皮毛的小灵兽，节奏压制力强。" , skill: { name: "焰尾灼烧", desc: "触发时额外造成 15% 无视防御的真实伤害" } },
    { id: "alpaca", name: "云岭羊驼", rarity: "normal", asset: "./pets/alpaca", desc: "高地来客，耐性极佳的团队稳定器。" , skill: { name: "云雾护体", desc: "触发时本回合受到的伤害减半" } },
    { id: "corgi", name: "迅捷柯基", rarity: "normal", asset: "./pets/corgi", desc: "短腿爆发力惊人，先手体系核心。" , skill: { name: "电光突进", desc: "触发时本次攻击无视对方防御" } },
    { id: "duck", name: "潮鸣鸭", rarity: "normal", asset: "./pets/call-duck", desc: "水陆双栖，状态恢复极快。" , skill: { name: "潮鸣涌动", desc: "触发时回复 5% 生命并使本次伤害 +10%" } },
    { id: "horse", name: "迅雷边牧", rarity: "normal", asset: "./pets/border-collie", desc: "天生指挥家，战术执行力爆表。" , skill: { name: "战术指挥", desc: "触发时本次伤害 +30%" } },
    { id: "sheep", name: "蓬云比熊", rarity: "normal", asset: "./pets/bichon", desc: "云朵般柔软，越战越稳的持久型。" , skill: { name: "云绒缓冲", desc: "触发时抵消本回合 60% 所受伤害" } },
    { id: "pig", name: "金鬃猎犬", rarity: "normal", asset: "./pets/golden-retriever", desc: "冲击力强，正面硬拼能力一流。" , skill: { name: "金鬃威压", desc: "触发时使对方下次攻击伤害 -20%" } },
    { id: "cow", name: "霜狼", rarity: "myth", asset: "./pets/husky", desc: "霜雪中走出的神兽，意志与速度兼备，寒气护体。" , skill: { name: "霜牙撕咬", desc: "触发时附加寒冷，对方下回合伤害 -25%" }, passive: { name: "凛冬庇护", desc: "所受的所有伤害降低 6%" } },
    { id: "dragon", name: "苍龙", rarity: "myth", asset: "./pets/azure-dragon", desc: "东方雷霆神兽，成长值显著更高。" , skill: { name: "苍雷冲击", desc: "触发时造成 160% 伤害" }, passive: { name: "龙威", desc: "每回合结束时回复 2% 最大生命" } },
    { id: "phoenix", name: "凤凰", rarity: "myth", asset: "./pets/vermilion-bird", desc: "浴火而生，爆发与意志兼备。" , skill: { name: "浴火重生", desc: "触发时回复 12% 最大生命" }, passive: { name: "涅槃余温", desc: "生命低于 30% 时，所受伤害降低 15%" } },
    { id: "pixiu", name: "貔貅", rarity: "myth", asset: "./pets/pixiu", desc: "吞金纳福的上古瑞兽，攻守全能。" , skill: { name: "吞金夺气", desc: "触发时造成 120% 伤害并回复其中 30% 生命" }, passive: { name: "聚灵护盾", desc: "开战时获得一层 6% 最大生命的护盾" } },
    { id: "tiger", name: "白虎", rarity: "normal", asset: "./pets/white-tiger", desc: "百兽之王，力量与防御兼备。" , skill: { name: "白虎咆哮", desc: "触发时造成 140% 伤害并使对方下次攻击 -15%" } },
  ];

  const LEGACY_SPECIES_MAP = {
    parrot: "raccoon", fish: "alpaca", turtle: "corgi", fox: "pixiu",
  };

  const SPECIES_MAP = Object.fromEntries(SPECIES.map((item) => [item.id, item]));
  const NORMAL_SPECIES = SPECIES.filter((item) => item.rarity === "normal");
  const MYTH_SPECIES = SPECIES.filter((item) => item.rarity === "myth");

  const SHOP_ITEMS = [
    { id: "canned", asset: "./assets/items/canned.svg", name: "鲜肉罐头", type: "living", price: 8, icon: "beef", desc: "饱食度 +30，健康 +5", effects: { satiety: 30, health: 5 } },
    { id: "milk", asset: "./assets/items/milk.svg", name: "温热鲜奶", type: "living", price: 6, icon: "milk", desc: "饱食度 +12，心情 +10", effects: { satiety: 12, mood: 10 } },
    { id: "toy", asset: "./assets/items/toy.svg", name: "毛线玩具", type: "living", price: 12, icon: "toy-brick", desc: "心情 +32", effects: { mood: 32 } },
    { id: "checkup", asset: "./assets/items/checkup.svg", name: "体检套餐", type: "living", price: 15, icon: "stethoscope", desc: "健康 +35", effects: { health: 35 } },
    { id: "xp-potion", asset: "./assets/items/xp-potion.svg", name: "经验药水", type: "living", price: 5, icon: "flask-conical", desc: "宠物经验 +40，是唯一的升级途径", effects: { xp: 40 } },
    { id: "herb", asset: "./assets/items/herb.svg", name: "灵芝水", type: "living", price: 26, icon: "leaf", desc: "健康/饱食/心情各 +15", effects: { health: 15, satiety: 15, mood: 15 } },
    { id: "reset-scroll", asset: "./assets/items/reset-scroll.svg", name: "忘却卷轴", type: "living", price: 10, icon: "eraser", desc: "重置全部属性加点，点数全部返还重新分配", effects: {} },
    { id: "claw-glove", asset: "./assets/items/claw-glove.svg", name: "磨爪手套", type: "equipment", slot: "weapon", price: 18, icon: "hand", bonuses: { strength: 2 }, desc: "武器：力量 +2" },
    { id: "swift-bell", asset: "./assets/items/swift-bell.svg", name: "疾风铃", type: "equipment", slot: "accessory", price: 20, icon: "bell", bonuses: { speed: 2 }, desc: "饰品：速度 +2" },
    { id: "guard-vest", asset: "./assets/items/guard-vest.svg", name: "守护背心", type: "equipment", slot: "armor", price: 24, icon: "shield", bonuses: { defense: 2 }, desc: "护甲：防御 +2" },
    { id: "life-pendant", asset: "./assets/items/life-pendant.svg", name: "生命坠饰", type: "equipment", slot: "accessory", price: 26, icon: "heart-pulse", bonuses: { vitality: 2 }, desc: "饰品：体质 +2" },
    { id: "star-blade", asset: "./assets/items/star-blade.svg", name: "星光爪", type: "equipment", slot: "weapon", price: 48, icon: "sparkles", bonuses: { strength: 3, focus: 1 }, desc: "武器：力量 +3，会心 +1" },
    { id: "dragon-scale", asset: "./assets/items/dragon-scale.svg", name: "龙鳞甲", type: "equipment", slot: "armor", price: 58, icon: "shield-check", bonuses: { defense: 3, vitality: 2 }, desc: "护甲：防御 +3，体质 +2" },
    { id: "mythic-evolution", asset: "./assets/items/mythic-evolution.svg", name: "神兽进化核心", type: "evolution", price: 500, icon: "sparkles", desc: "消耗 500 积分，将当前宠物进化为随机神兽" },
  ];

  const SHOP_MAP = Object.fromEntries(SHOP_ITEMS.map((item) => [item.id, item]));

  const STAT_LABELS = {
    strength: "力量",
    speed: "速度",
    vitality: "体质",
    defense: "防御",
    focus: "会心",
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function scoreToPoints(score) {
    const numeric = Number(score) || 0;
    return Math.max(0, Math.floor(numeric / 10));
  }

  function createStudent(classId, row) {
    return {
      id: uid("stu"),
      classId,
      studentNo: String(row.studentNo ?? "").trim(),
      name: String(row.name ?? "").trim(),
      gender: row.gender === "男" || row.gender === "女" ? row.gender : "其他",
      points: clamp(row.points === undefined || row.points === "" ? 100 : Number(row.points) || 0, 0, 100000),
      pet: null,
      scores: [],
      transactions: [],
      battles: { wins: 0, losses: 0, total: 0 },
      createdAt: new Date().toISOString(),
    };
  }

  function createPet(speciesId) {
    return {
      id: uid("pet"),
      speciesId,
      nickname: "",
      level: 1,
      xp: 0,
      base: { health: 80, satiety: 80, mood: 80 },
      stats: { strength: 0, speed: 0, vitality: 0, defense: 0, focus: 0 },
      inventory: [],
      equipment: [],
      titles: [],
      equipped: { weapon: null, armor: null, accessory: null, title: null },
      careCount: 0,
      battleCount: 0,
      createdAt: new Date().toISOString(),
    };
  }

  function randomSpecies(rarity = "normal") {
    const pool = rarity === "myth" ? MYTH_SPECIES : NORMAL_SPECIES;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function statPool(pet) {
    const species = SPECIES_MAP[pet.speciesId];
    if (!species) return 0;
    const start = species.rarity === "myth" ? 15 : 10;
    const growth = species.rarity === "myth" ? 5 : 3;
    return start + (pet.level - 1) * growth;
  }

  function allocatedPoints(pet) {
    return Object.values(pet.stats).reduce((sum, value) => sum + (Number(value) || 0), 0);
  }

  function availablePoints(pet) {
    return Math.max(0, statPool(pet) - allocatedPoints(pet));
  }

  function equippedBonuses(pet) {
    const bonuses = { strength: 0, speed: 0, vitality: 0, defense: 0, focus: 0 };
    // 已佩戴称号：全属性 +1（有效期 1 个月）
    const wornTitle = (pet.titles || []).find((t) => t.id === (pet.equipped || {}).title);
    if (wornTitle && (!wornTitle.expiresAt || new Date(wornTitle.expiresAt) > new Date())) {
      Object.keys(bonuses).forEach((key) => { bonuses[key] += 1; });
    }
    Object.values(pet.equipped || {}).forEach((equipmentId) => {
      if (!equipmentId) return;
      const owned = (pet.equipment || []).find((item) => item.instanceId === equipmentId);
      if (!owned) return;
      const def = SHOP_MAP[owned.itemId];
      if (!def) return;
      Object.entries(def.bonuses || {}).forEach(([key, value]) => {
        bonuses[key] += value;
      });
    });
    return bonuses;
  }

  function effectiveStats(pet) {
    const bonuses = equippedBonuses(pet);
    const result = {};
    Object.keys(STAT_LABELS).forEach((key) => {
      result[key] = (Number(pet.stats[key]) || 0) + bonuses[key];
    });
    return result;
  }

  function petMaxHp(pet) {
    return 80 + effectiveStats(pet).vitality * 8;
  }

  function combatPower(pet) {
    const stats = effectiveStats(pet);
    return Math.round(
      stats.strength * 8 +
        stats.speed * 7 +
        stats.vitality * 7 +
        stats.defense * 6 +
        stats.focus * 6 +
        pet.level * 5
    );
  }

  function xpToNext(level) {
    return 80 + (level - 1) * 70;
  }

  function gainPetXp(pet, amount) {
    const events = [];
    pet.xp += Math.max(0, Math.round(amount));
    while (pet.level < 10 && pet.xp >= xpToNext(pet.level)) {
      pet.xp -= xpToNext(pet.level);
      pet.level += 1;
      events.push(pet.level);
    }
    if (pet.level >= 10) pet.xp = Math.min(pet.xp, xpToNext(10));
    return events;
  }

  function winRate(student) {
    const total = student.battles.wins + student.battles.losses;
    return total ? (student.battles.wins / total) * 100 : 0;
  }

  function formatTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  // 等级（1-10）映射到素材的 8 个进化阶段
  function assetFor(species, level = 1) {
    const stage = clamp(Math.ceil((Number(level) || 1) * 8 / 10), 1, 8);
    return `${species.asset}/lv${stage}.png`;
  }

  window.CP = {
    SPECIES,
    SPECIES_MAP,
    NORMAL_SPECIES,
    MYTH_SPECIES,
    LEGACY_SPECIES_MAP,
    SHOP_ITEMS,
    SHOP_MAP,
    STAT_LABELS,
    clamp,
    uid,
    scoreToPoints,
    assetFor,
    createStudent,
    createPet,
    randomSpecies,
    statPool,
    allocatedPoints,
    availablePoints,
    equippedBonuses,
    effectiveStats,
    petMaxHp,
    combatPower,
    xpToNext,
    gainPetXp,
    winRate,
    formatTime,
  };
})();
