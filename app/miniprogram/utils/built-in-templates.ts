// utils/built-in-templates.ts
// 内置报告模板
// 第一套「文学散文风」：用散文笔触记录这一年与书的相遇
// 文案参考用户描述的读书报告风格重写，保持文学性、叙事感、情境化

import { ReportTemplate } from './storage'

export function getBuiltInTemplates(): ReportTemplate[] {
  return [
    {
      id: 'builtin-literary',
      name: '文学散文风',
      description: '用散文笔触记录这一年与书的相遇，适合年度总结',
      isBuiltIn: true,
      cards: [
        {
          type: 'cover',
          titleTemplate: '{reportTitle}',
          contentTemplate: '{year}\n这一年，与书相遇',
        },
        {
          type: 'overview',
          titleTemplate: '这一年',
          contentTemplate: '这一年，你一共读了 {bookCount} 本书。\n平均每一本，你都给了 {avgRating} 颗星的偏爱。\n{topGenre}，是你反复回望的方向。',
        },
        {
          type: 'footprint',
          titleTemplate: '阅读的足迹',
          contentTemplate: '{?topPlace}你的阅读足迹，遍布 {places}。\n其中 {topPlace} 出现了 {topPlaceCount} 次——\n那里，大概是你的精神故乡。{/}',
        },
        {
          type: 'favorite',
          titleTemplate: '年度之书',
          contentTemplate: '{?topBook}若只能选一本，\n那便是《{topBook}》。{/}{?topBookNote}\n\n{topBookNote}{/}',
        },
        {
          type: 'theme',
          titleTemplate: '一场漫长的跋涉',
          contentTemplate: '这一年，你依旧在 {themeGenre} 中跋涉。\n那些字句像过了一辈子那样疲惫，\n又像过了一辈子那样辽阔。',
        },
        {
          type: 'quote',
          titleTemplate: '字里行间',
          contentTemplate: '{#quoteList}「{text}」\n—— 《{book}》\n\n{/}',
        },
        {
          type: 'journey',
          titleTemplate: '在路上',
          contentTemplate: '{#journeyList}你在 {place}，翻开过《{book}》。\n{/}旅途能赋予书全新的意义，\n书也能让旅途不再孤单。',
        },
        {
          type: 'ending',
          titleTemplate: '',
          contentTemplate: '愿你今后的旅程，\n永远有书相伴，\n永远自由坦荡。',
        },
      ],
    },

    /* ============================================================
     * 模板 2：极简数据风
     * 数字驱动短句，素白底 + 大数字字号，干净利落
     * ============================================================ */
    {
      id: 'builtin-minimal-data',
      name: '极简数据风',
      description: '用数字与短句勾勒一年的阅读，干净利落',
      isBuiltIn: true,
      cards: [
        {
          type: 'cover',
          titleTemplate: '{reportTitle}',
          contentTemplate: '{year}\n{bookCount} 本书',
          style: { bgType: 'color', bgColor: '#FFFFFF', textColor: '#1A1A1A', titleColor: '#1A1A1A', textAlign: 'center', fontSizeScale: 1.15 },
        },
        {
          type: 'overview',
          titleTemplate: '',
          contentTemplate: '{bookCount} 本\n{avgRating} 星\n{topGenre}',
          style: { bgType: 'color', bgColor: '#FFFFFF', textColor: '#1A1A1A', textAlign: 'center', fontSizeScale: 1.3 },
        },
        {
          type: 'footprint',
          titleTemplate: '',
          contentTemplate: '{placeCount} 个地方\n{topPlace} × {topPlaceCount}',
          style: { bgType: 'color', bgColor: '#FFFFFF', textColor: '#1A1A1A', textAlign: 'center', fontSizeScale: 1.15 },
        },
        {
          type: 'favorite',
          titleTemplate: '',
          contentTemplate: '《{topBook}》\n{topBookAuthor}',
          style: { bgType: 'color', bgColor: '#FFFFFF', textColor: '#1A1A1A', textAlign: 'center', fontSizeScale: 1.0 },
        },
        {
          type: 'theme',
          titleTemplate: '',
          contentTemplate: '主题词\n{themeGenre}',
          style: { bgType: 'color', bgColor: '#FFFFFF', textColor: '#1A1A1A', textAlign: 'center', fontSizeScale: 1.0 },
        },
        {
          type: 'quote',
          titleTemplate: '',
          contentTemplate: '{#quoteList}「{text}」\n—— 《{book}》\n\n{/}',
          style: { bgType: 'color', bgColor: '#FFFFFF', textColor: '#1A1A1A', textAlign: 'center', fontSizeScale: 1.0 },
        },
        {
          type: 'journey',
          titleTemplate: '',
          contentTemplate: '{#journeyList}{place}\n《{book}》\n\n{/}',
          style: { bgType: 'color', bgColor: '#FFFFFF', textColor: '#1A1A1A', textAlign: 'center', fontSizeScale: 1.0 },
        },
        {
          type: 'ending',
          titleTemplate: '',
          contentTemplate: '{year}\n已读 {bookCount} 本',
          style: { bgType: 'color', bgColor: '#FFFFFF', textColor: '#1A1A1A', textAlign: 'center', fontSizeScale: 1.15 },
        },
      ],
    },

    /* ============================================================
     * 模板 3：复古书信风
     * 以「亲爱的，这一年我想告诉你…」开篇，米黄纸感，娓娓道来
     * ============================================================ */
    {
      id: 'builtin-retro-letter',
      name: '复古书信风',
      description: '像写给故人的一封信，娓娓道来这一年的阅读',
      isBuiltIn: true,
      cards: [
        {
          type: 'cover',
          titleTemplate: '{reportTitle}',
          contentTemplate: '亲爱的：\n这一年的事，\n我想慢慢说给你听。',
          style: { bgType: 'color', bgColor: '#FBF1DD', textColor: '#5A4A38', titleColor: '#C26B6B', textAlign: 'center', fontSizeScale: 1.15 },
        },
        {
          type: 'overview',
          titleTemplate: '其一',
          contentTemplate: '这一年我读完了 {bookCount} 本书。\n给它们打分时，平均落在 {avgRating} 颗星。\n我在 {topGenre} 上停留得最久——\n那大概是我心里反复回望的方向。',
          style: { bgType: 'color', bgColor: '#FBF1DD', textColor: '#5A4A38', titleColor: '#C26B6B', textAlign: 'left', fontSizeScale: 1.0 },
        },
        {
          type: 'footprint',
          titleTemplate: '其二',
          contentTemplate: '我辗转了 {placeCount} 个地方。\n其中 {topPlace} 出现了 {topPlaceCount} 次。\n你问我哪里最像家，\n我想，是那些有书的角落。',
          style: { bgType: 'color', bgColor: '#FBF1DD', textColor: '#5A4A38', titleColor: '#C26B6B', textAlign: 'left', fontSizeScale: 1.0 },
        },
        {
          type: 'favorite',
          titleTemplate: '其三',
          contentTemplate: '{?topBook}若只能挑一本寄给你，\n那会是《{topBook}》。{/}{?topBookNote}\n\n{topBookNote}{/}',
          style: { bgType: 'color', bgColor: '#FBF1DD', textColor: '#5A4A38', titleColor: '#C26B6B', textAlign: 'left', fontSizeScale: 1.0 },
        },
        {
          type: 'theme',
          titleTemplate: '其四',
          contentTemplate: '这一年我在 {themeGenre} 里跋涉。\n那些字句像过了一辈子那样疲惫，\n又像过了一辈子那样辽阔。',
          style: { bgType: 'color', bgColor: '#FBF1DD', textColor: '#5A4A38', titleColor: '#C26B6B', textAlign: 'left', fontSizeScale: 1.0 },
        },
        {
          type: 'quote',
          titleTemplate: '其五',
          contentTemplate: '我一直记得这些句子：\n\n{#quoteList}「{text}」\n—— 《{book}》\n\n{/}',
          style: { bgType: 'color', bgColor: '#FBF1DD', textColor: '#5A4A38', titleColor: '#C26B6B', textAlign: 'left', fontSizeScale: 1.0 },
        },
        {
          type: 'journey',
          titleTemplate: '其六',
          contentTemplate: '{#journeyList}我在 {place}，翻开过《{book}》。\n{/}旅途让书有了新的味道，\n书让旅途不再孤单。',
          style: { bgType: 'color', bgColor: '#FBF1DD', textColor: '#5A4A38', titleColor: '#C26B6B', textAlign: 'left', fontSizeScale: 1.0 },
        },
        {
          type: 'ending',
          titleTemplate: '',
          contentTemplate: '信写到这儿。\n愿你今后也有书相伴。\n\n{year} 敬上',
          style: { bgType: 'color', bgColor: '#FBF1DD', textColor: '#5A4A38', titleColor: '#C26B6B', textAlign: 'center', fontSizeScale: 1.15 },
        },
      ],
    },

    /* ============================================================
     * 模板 4：诗歌断行风
     * 大量留白，短句断行，极简底 + 居中，呼吸感
     * ============================================================ */
    {
      id: 'builtin-poetry',
      name: '诗歌断行风',
      description: '短句断行，大量留白，像一首关于阅读的诗',
      isBuiltIn: true,
      cards: [
        {
          type: 'cover',
          titleTemplate: '{reportTitle}',
          contentTemplate: '{year}\n\n这一年\n与书相遇',
          style: { bgType: 'color', bgColor: '#FFFFFF', textColor: '#4A4A4A', titleColor: '#1A1A1A', textAlign: 'center', fontSizeScale: 0.9 },
        },
        {
          type: 'overview',
          titleTemplate: '',
          contentTemplate: '{bookCount} 本\n\n读完\n\n平均 {avgRating} 星\n\n{topGenre}\n\n反复回望',
          style: { bgType: 'color', bgColor: '#FFFFFF', textColor: '#4A4A4A', textAlign: 'center', fontSizeScale: 0.9 },
        },
        {
          type: 'footprint',
          titleTemplate: '',
          contentTemplate: '{placeCount} 个\n\n地方\n\n{topPlace}\n\n{topPlaceCount} 次',
          style: { bgType: 'color', bgColor: '#FFFFFF', textColor: '#4A4A4A', textAlign: 'center', fontSizeScale: 0.9 },
        },
        {
          type: 'favorite',
          titleTemplate: '',
          contentTemplate: '若只一本\n\n《{topBook}》',
          style: { bgType: 'color', bgColor: '#FFFFFF', textColor: '#4A4A4A', textAlign: 'center', fontSizeScale: 0.9 },
        },
        {
          type: 'theme',
          titleTemplate: '',
          contentTemplate: '{themeGenre}\n\n跋涉\n\n疲惫\n\n又辽阔',
          style: { bgType: 'color', bgColor: '#FFFFFF', textColor: '#4A4A4A', textAlign: 'center', fontSizeScale: 0.9 },
        },
        {
          type: 'quote',
          titleTemplate: '',
          contentTemplate: '{#quoteList}「{text}」\n\n—— 《{book}》\n\n{/}',
          style: { bgType: 'color', bgColor: '#FFFFFF', textColor: '#4A4A4A', textAlign: 'center', fontSizeScale: 0.9 },
        },
        {
          type: 'journey',
          titleTemplate: '',
          contentTemplate: '{#journeyList}{place}\n《{book}》\n\n{/}',
          style: { bgType: 'color', bgColor: '#FFFFFF', textColor: '#4A4A4A', textAlign: 'center', fontSizeScale: 0.9 },
        },
        {
          type: 'ending',
          titleTemplate: '',
          contentTemplate: '愿\n\n书\n\n相伴',
          style: { bgType: 'color', bgColor: '#FFFFFF', textColor: '#4A4A4A', textAlign: 'center', fontSizeScale: 0.9 },
        },
      ],
    },

    /* ============================================================
     * 模板 5：旅行手账风
     * 突出地点情境，纸质纹理底，手账感
     * ============================================================ */
    {
      id: 'builtin-travel-journal',
      name: '旅行手账风',
      description: '突出阅读发生的地点与情境，像一本阅读手账',
      isBuiltIn: true,
      cards: [
        {
          type: 'cover',
          titleTemplate: '{reportTitle}',
          contentTemplate: '📍 {year}\n一本书，一段路\n属于我的阅读手账',
          style: { bgType: 'color', bgColor: '#FAF6F0', textColor: '#5A4A38', titleColor: '#D97A4A', textAlign: 'left', fontSizeScale: 1.1 },
        },
        {
          type: 'overview',
          titleTemplate: '这一年读了',
          contentTemplate: '{bookCount} 本书 📚\n平均 {avgRating} 星 ⭐\n最爱 {topGenre}\n走过 {placeCount} 个地方 🗺️',
          style: { bgType: 'color', bgColor: '#FAF6F0', textColor: '#5A4A38', titleColor: '#D97A4A', textAlign: 'left', fontSizeScale: 1.0 },
        },
        {
          type: 'footprint',
          titleTemplate: '阅读的足迹',
          contentTemplate: '📍 {topPlace} × {topPlaceCount}\n是我去得最多的阅读角落\n\n{places}\n这些地方，\n都留下了翻书的瞬间。',
          style: { bgType: 'color', bgColor: '#FAF6F0', textColor: '#5A4A38', titleColor: '#D97A4A', textAlign: 'left', fontSizeScale: 1.0 },
        },
        {
          type: 'favorite',
          titleTemplate: '手账里的主角',
          contentTemplate: '{?topBook}《{topBook}》\n{topBookAuthor}{/}{?topBookNote}\n\n📝 {topBookNote}{/}',
          style: { bgType: 'color', bgColor: '#FAF6F0', textColor: '#5A4A38', titleColor: '#D97A4A', textAlign: 'left', fontSizeScale: 1.0 },
        },
        {
          type: 'theme',
          titleTemplate: '这一年的色调',
          contentTemplate: '🎨 {themeGenre}\n是我反复停留的色调\n那些字句像跋涉\n又像辽阔的旷野。',
          style: { bgType: 'color', bgColor: '#FAF6F0', textColor: '#5A4A38', titleColor: '#D97A4A', textAlign: 'left', fontSizeScale: 1.0 },
        },
        {
          type: 'quote',
          titleTemplate: '抄下来的句子',
          contentTemplate: '{#quoteList}✒️ 「{text}」\n—— 《{book}》\n\n{/}',
          style: { bgType: 'color', bgColor: '#FAF6F0', textColor: '#5A4A38', titleColor: '#D97A4A', textAlign: 'left', fontSizeScale: 1.0 },
        },
        {
          type: 'journey',
          titleTemplate: '在路上',
          contentTemplate: '{#journeyList}🚄 {place} → 《{book}》\n{/}\n旅途赋予书新的意义\n书让旅途不再孤单。',
          style: { bgType: 'color', bgColor: '#FAF6F0', textColor: '#5A4A38', titleColor: '#D97A4A', textAlign: 'left', fontSizeScale: 1.0 },
        },
        {
          type: 'ending',
          titleTemplate: '',
          contentTemplate: '手账合上\n但旅程未完\n愿你今后\n永远有书相伴 📖',
          style: { bgType: 'color', bgColor: '#FAF6F0', textColor: '#5A4A38', titleColor: '#D97A4A', textAlign: 'center', fontSizeScale: 1.1 },
        },
      ],
    },

    /* ============================================================
     * 模板 6：年度成就回顾（成就系统主轴）
     * 跨分类汇总，散文笔触回顾一年里所有值得纪念的成就
     * 用成就变量 {achievementCount}/{topCategory}/{categoryList} 等
     * ============================================================ */
    {
      id: 'builtin-achievement-annual',
      name: '年度成就回顾',
      description: '汇总一年里所有值得纪念的成就，跨分类的散文回顾',
      isBuiltIn: true,
      cards: [
        {
          type: 'cover',
          titleTemplate: '{reportTitle}',
          contentTemplate: '{year}\n这一年，我做到了',
          style: { bgType: 'gradient', bgGradient: ['#D97A4A', '#E8A33D'], textColor: '#FFFFFF', titleColor: '#FFFFFF', textAlign: 'center', fontSizeScale: 1.2 },
        },
        {
          type: 'overview',
          titleTemplate: '这一年',
          contentTemplate: '这一年，我达成了 {achievementCount} 个成就。\n它们分布在 {categoryCount} 个不同的领域——\n{categoryList}。\n每一个，都是认真活过的证据。',
          style: { bgType: 'color', bgColor: '#FAF6F0', textColor: '#3D3530', titleColor: '#D97A4A', textAlign: 'left', fontSizeScale: 1.0 },
        },
        {
          type: 'footprint',
          titleTemplate: '我最投入的方向',
          contentTemplate: '若问这一年我最投入哪里，\n那一定是 {topCategory}——\n{topCategoryCount} 次，是我反复回来的地方。\n那里，藏着我最深的热爱。',
          style: { bgType: 'color', bgColor: '#FAF6F0', textColor: '#3D3530', titleColor: '#D97A4A', textAlign: 'left', fontSizeScale: 1.0 },
        },
        {
          type: 'favorite',
          titleTemplate: '最闪光的那个',
          contentTemplate: '{?milestone1}若只能挑一个最闪光的，\n那便是「{milestone1}」。{/}{?milestone1Note}\n\n{milestone1Note}{/}',
          style: { bgType: 'color', bgColor: '#FAF6F0', textColor: '#3D3530', titleColor: '#D97A4A', textAlign: 'left', fontSizeScale: 1.0 },
        },
        {
          type: 'theme',
          titleTemplate: '第一次的勇气',
          contentTemplate: '这一年，我收获了 {firstTimeCount} 个「第一次」。\n第一次，总是带着心跳和胆怯。\n但也正是这些第一次，\n让我变成了不一样的人。',
          style: { bgType: 'color', bgColor: '#FAF6F0', textColor: '#3D3530', titleColor: '#D97A4A', textAlign: 'left', fontSizeScale: 1.0 },
        },
        {
          type: 'quote',
          titleTemplate: '值得一提的',
          contentTemplate: '还有这些，值得一提：\n\n「{milestone2}」\n「{milestone3}」\n\n它们或许不那么耀眼，\n却是我一步一个脚印的证明。',
          style: { bgType: 'color', bgColor: '#FAF6F0', textColor: '#3D3530', titleColor: '#D97A4A', textAlign: 'left', fontSizeScale: 1.0 },
        },
        {
          type: 'journey',
          titleTemplate: '时间的跨度',
          contentTemplate: '从第一个到最后一个，\n跨越了 {dateSpan} 天。\n最近完成的，是「{recentAchievement}」。\n\n时间走得很快，\n但我没有停下。',
          style: { bgType: 'color', bgColor: '#FAF6F0', textColor: '#3D3530', titleColor: '#D97A4A', textAlign: 'left', fontSizeScale: 1.0 },
        },
        {
          type: 'ending',
          titleTemplate: '',
          contentTemplate: '感谢这一年里\n那个不曾放弃的自己。\n愿来年，\n仍有热爱，仍有勇气。',
          style: { bgType: 'gradient', bgGradient: ['#D97A4A', '#E8A33D'], textColor: '#FFFFFF', titleColor: '#FFFFFF', textAlign: 'center', fontSizeScale: 1.15 },
        },
      ],
    },

    /* ============================================================
     * 模板 7：里程碑纪念（成就系统主轴，精简 6 卡）
     * 突出最重要的几个成就，适合单次大事件或阶段性总结
     * ============================================================ */
    {
      id: 'builtin-achievement-milestone',
      name: '里程碑纪念',
      description: '突出几个最值得纪念的成就，适合单次大事件或阶段性总结',
      isBuiltIn: true,
      cards: [
        {
          type: 'cover',
          titleTemplate: '{reportTitle}',
          contentTemplate: '{topCategoryIcon} {year}\n属于我的里程碑',
          style: { bgType: 'color', bgColor: '#2C2C2C', textColor: '#F5E6D3', titleColor: '#E8A33D', textAlign: 'center', fontSizeScale: 1.2 },
        },
        {
          type: 'overview',
          titleTemplate: '这一程',
          contentTemplate: '{achievementCount} 个成就\n{categoryCount} 个领域\n{dateSpan} 天的坚持',
          style: { bgType: 'color', bgColor: '#2C2C2C', textColor: '#F5E6D3', titleColor: '#E8A33D', textAlign: 'center', fontSizeScale: 1.3 },
        },
        {
          type: 'favorite',
          titleTemplate: '最重要的一个',
          contentTemplate: '{?milestone1}「{milestone1}」{/}{?milestone1Note}\n\n{milestone1Note}{/}',
          style: { bgType: 'color', bgColor: '#2C2C2C', textColor: '#F5E6D3', titleColor: '#E8A33D', textAlign: 'center', fontSizeScale: 1.05 },
        },
        {
          type: 'theme',
          titleTemplate: '一路走来',
          contentTemplate: '还有：\n{milestone2}\n{milestone3}\n\n每一个名字背后，\n都有一段不愿将就的日子。',
          style: { bgType: 'color', bgColor: '#2C2C2C', textColor: '#F5E6D3', titleColor: '#E8A33D', textAlign: 'center', fontSizeScale: 1.0 },
        },
        {
          type: 'journey',
          titleTemplate: '从未停下',
          contentTemplate: '从开始到现在，\n{dateSpan} 天。\n最近完成的：\n「{recentAchievement}」',
          style: { bgType: 'color', bgColor: '#2C2C2C', textColor: '#F5E6D3', titleColor: '#E8A33D', textAlign: 'center', fontSizeScale: 1.0 },
        },
        {
          type: 'ending',
          titleTemplate: '',
          contentTemplate: '这一个里程碑\n不是终点\n是下一段旅程的\n起点',
          style: { bgType: 'color', bgColor: '#2C2C2C', textColor: '#F5E6D3', titleColor: '#E8A33D', textAlign: 'center', fontSizeScale: 1.15 },
        },
      ],
    },

    /* ============================================================
     * 模板 8：给未来自己的一封信
     * 散文式串联全年成就成「一封信」；书信风米黄底，6 卡。
     * 叙事视角：现在的自己写信给未来的自己，回顾这一年做过的努力。
     * ============================================================ */
    {
      id: 'builtin-future-letter',
      name: '给未来自己的一封信',
      description: '以写信的口吻把这一年的成长寄给未来的自己',
      isBuiltIn: true,
      cards: [
        {
          type: 'cover',
          titleTemplate: '{reportTitle}',
          contentTemplate: '亲爱的未来的我：\n\n写下这封信时，\n{year} 还没有走完它的故事。\n我想把这一年的自己，\n原原本本地寄给你。',
          style: { bgType: 'color', bgColor: '#FBF1DD', textColor: '#5A4A38', titleColor: '#C26B6B', textAlign: 'center', fontSizeScale: 1.1 },
        },
        {
          type: 'overview',
          titleTemplate: '开篇',
          contentTemplate: '这一年的我，\n一共达成了 {achievementCount} 件事。\n它们散落在 {categoryCount} 个不同的领域——\n{categoryList}。\n\n每一件，都是我没有辜负时光的证据。',
          style: { bgType: 'color', bgColor: '#FBF1DD', textColor: '#5A4A38', titleColor: '#C26B6B', textAlign: 'left', fontSizeScale: 1.0 },
        },
        {
          type: 'footprint',
          titleTemplate: '最深的热爱',
          contentTemplate: '若你问我这一年最投入哪里，\n我会说是 {topCategory}——\n{topCategoryCount} 次反复回来。\n\n那里，藏着现在的我\n最不愿放手的热爱的形状。',
          style: { bgType: 'color', bgColor: '#FBF1DD', textColor: '#5A4A38', titleColor: '#C26B6B', textAlign: 'left', fontSizeScale: 1.0 },
        },
        {
          type: 'favorite',
          titleTemplate: '最骄傲的一件',
          contentTemplate: '{?milestone1}若只能挑一件最骄傲的寄给你，\n那会是「{milestone1}」。{/}{?milestone1Note}\n\n{milestone1Note}{/}\n\n那一刻的我，\n希望你还没有忘记。',
          style: { bgType: 'color', bgColor: '#FBF1DD', textColor: '#5A4A38', titleColor: '#C26B6B', textAlign: 'left', fontSizeScale: 1.0 },
        },
        {
          type: 'journey',
          titleTemplate: '走过的路',
          contentTemplate: '从第一件到最近的一件，\n跨度 {dateSpan} 天。\n最近完成的，是「{recentAchievement}」。\n\n时间走得比我想象的快，\n但我没有让自己停下。',
          style: { bgType: 'color', bgColor: '#FBF1DD', textColor: '#5A4A38', titleColor: '#C26B6B', textAlign: 'left', fontSizeScale: 1.0 },
        },
        {
          type: 'ending',
          titleTemplate: '',
          contentTemplate: '信写到这儿。\n愿你读到时，\n已成为自己想成为的样子。\n\n现在的我 敬上\n{year}',
          style: { bgType: 'color', bgColor: '#FBF1DD', textColor: '#5A4A38', titleColor: '#C26B6B', textAlign: 'center', fontSizeScale: 1.15 },
        },
      ],
    },
  ]
}
