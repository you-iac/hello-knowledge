(function () {
  "use strict";

  const DEFAULT_MODEL = "deepseek-v4-flash";

  const state = {
    cards: []
  };

  const els = {
    queryForm: document.getElementById("queryForm"),
    queryInput: document.getElementById("queryInput"),
    endpointInput: document.getElementById("endpointInput"),
    modelInput: document.getElementById("modelInput"),
    apiKeyInput: document.getElementById("apiKeyInput"),
    clearButton: document.getElementById("clearButton"),
    cards: document.getElementById("cards"),
    emptyState: document.getElementById("emptyState"),
    pathList: document.getElementById("pathList"),
    cardTemplate: document.getElementById("cardTemplate")
  };

  init();

  function init() {
    els.modelInput.value = DEFAULT_MODEL;

    els.queryForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const term = els.queryInput.value.trim();
      if (term) {
        requestConcept(term, -1);
      }
    });

    els.clearButton.addEventListener("click", () => {
      state.cards = [];
      els.cards.innerHTML = "";
      renderPath();
      updateEmptyState();
      els.queryInput.focus();
    });

    updateEmptyState();
  }

  async function requestConcept(term, parentIndex, keyword) {
    const config = getConfig();
    if (!config.ok) {
      showClientError(config.message);
      return;
    }

    const parent = parentIndex >= 0 ? state.cards[parentIndex] : null;
    const loadingIndex = parentIndex + 1;
    state.cards = state.cards.slice(0, loadingIndex);
    state.cards.push({
      title: term,
      type: "生成中",
      answer: "正在向模型请求解释...",
      keywords: [],
      loading: true,
      parentTitle: parent ? parent.title : "",
      selectedFromParent: keyword ? keyword.text : ""
    });
    renderCards();

    try {
      const prompt = buildPrompt(term, parent, keyword);
      const response = await callModel(config, prompt);
      state.cards[loadingIndex] = normalizeCard(response, term, parent, keyword);
      renderCards();
    } catch (error) {
      state.cards[loadingIndex] = {
        title: term,
        type: "请求失败",
        answer: [
          `请求失败：${error.message || "未知错误"}`,
          "",
          "请检查 API 地址、模型名、API Key，以及浏览器是否允许直接跨域访问该接口。",
          "",
          "当前原型没有本地服务，也不缓存；每次查询都由浏览器直接请求模型接口。"
        ].join("\n"),
        keywords: [],
        error: true,
        parentTitle: parent ? parent.title : "",
        selectedFromParent: keyword ? keyword.text : ""
      };
      renderCards();
    }
  }

  function getConfig() {
    const endpoint = els.endpointInput.value.trim();
    const model = els.modelInput.value.trim();
    const apiKey = els.apiKeyInput.value.trim();

    if (!endpoint) {
      return { ok: false, message: "请填写 API 地址。" };
    }
    if (!model) {
      return { ok: false, message: "请填写模型名。" };
    }
    if (!apiKey) {
      return { ok: false, message: "请填写 API Key。它只会保存在当前页面内存里。" };
    }

    return { ok: true, endpoint, model, apiKey };
  }

  function buildPrompt(term, parent, keyword) {
    const path = state.cards
      .filter((card) => !card.loading && !card.error)
      .map((card) => card.title)
      .join(" -> ");

    const parentContext = parent ? [
      `父概念：${parent.title}`,
      `用户在父概念中选择的关键词：${keyword ? keyword.text : term}`,
      keyword && keyword.query ? `关键词查询意图：${keyword.query}` : "",
      keyword && keyword.reason ? `选择原因：${keyword.reason}` : "",
      `当前理解路径：${path || parent.title}`,
      "要求：这次解释要服务于父概念语境，帮助用户不中断主线。"
    ].filter(Boolean).join("\n") : "这是主概念查询，没有父概念。";

    return [
      "你是一个用于抗打断学习的概念解释器。",
      "用户会沿着概念中的关键词逐层展开。你的任务是给出自然、清楚、有信息密度的解释，并标出值得继续展开的关键词。",
      "",
      parentContext,
      "",
      `当前要解释的概念：${term}`,
      "",
      "请让正文自由发挥，不要被固定小节限制。可以使用短段落、列表、对比、例子、必要的术语解释。",
      "但请控制长度：主概念可以稍完整，子概念要更短、更贴合父概念。",
      "",
      "只返回 JSON，不要返回 Markdown 代码块，不要添加 JSON 外的说明。",
      "JSON 格式：",
      "{",
      '  "title": "概念名",',
      '  "type": "概念类型或标签",',
      '  "answer": "自由格式正文，可以包含 Markdown 风格的段落、列表、加粗、二级标题等",',
      '  "keywords": [',
      '    { "text": "关键词", "query": "带上下文的后续查询意图", "reason": "为什么值得继续展开" }',
      "  ]",
      "}",
      "",
      "关键词要求：",
      "- 给 5 到 10 个关键词。",
      "- 关键词必须来自或紧贴正文内容。",
      "- 优先选择会影响理解、容易打断主线、但值得旁路查看的概念。",
      "- 不要把普通动词、空泛词、整句描述当关键词。",
      "- 如果有父概念，query 要体现“在父概念语境下解释这个关键词”。"
    ].join("\n");
  }

  async function callModel(config, prompt) {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "system",
            content: "你只输出可解析 JSON。"
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.45
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    }

    const data = await response.json();
    return parseJsonContent(extractText(data));
  }

  function extractText(data) {
    if (typeof data.output_text === "string") {
      return data.output_text;
    }

    const choice = data.choices && data.choices[0];
    if (choice && choice.message && typeof choice.message.content === "string") {
      return choice.message.content;
    }
    if (choice && typeof choice.text === "string") {
      return choice.text;
    }

    if (Array.isArray(data.output)) {
      return data.output
        .flatMap((item) => item.content || [])
        .map((part) => part.text || part.output_text || "")
        .join("\n");
    }

    throw new Error("无法从模型响应中读取文本。");
  }

  function parseJsonContent(content) {
    const cleaned = String(content || "")
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch (error) {
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start >= 0 && end > start) {
        return JSON.parse(cleaned.slice(start, end + 1));
      }
      throw new Error("模型没有返回可解析 JSON。");
    }
  }

  function normalizeCard(raw, fallbackTitle, parent, keyword) {
    const keywords = Array.isArray(raw.keywords) ? raw.keywords : [];

    return {
      title: String(raw.title || fallbackTitle).trim(),
      type: String(raw.type || "模型生成").trim(),
      answer: String(raw.answer || raw.content || raw.summary || "").trim() || "模型没有提供正文。",
      keywords: keywords
        .map((item) => normalizeKeyword(item))
        .filter((item) => item.text)
        .slice(0, 12),
      parentTitle: parent ? parent.title : "",
      selectedFromParent: keyword ? keyword.text : ""
    };
  }

  function normalizeKeyword(item) {
    if (typeof item === "string") {
      return { text: item, query: item, reason: "" };
    }

    if (!item || typeof item !== "object") {
      return { text: "", query: "", reason: "" };
    }

    return {
      text: String(item.text || item.title || item.query || "").trim(),
      query: String(item.query || item.text || item.title || "").trim(),
      reason: String(item.reason || "").trim()
    };
  }

  function renderCards() {
    els.cards.innerHTML = "";

    state.cards.forEach((card, index) => {
      const node = els.cardTemplate.content.firstElementChild.cloneNode(true);
      node.classList.toggle("loading", Boolean(card.loading));
      node.classList.toggle("error", Boolean(card.error));
      node.querySelector(".card-kind").textContent = `${card.type || "概念"} / L${index + 1}`;
      node.querySelector("h2").textContent = card.title;
      node.querySelector(".answer").innerHTML = renderMarkdownLite(card.answer);

      const closeButton = node.querySelector(".remove-card");
      closeButton.addEventListener("click", () => {
        state.cards = state.cards.slice(0, index);
        renderCards();
      });

      const keywordWrap = node.querySelector(".keywords");
      if (card.loading) {
        keywordWrap.innerHTML = `<span class="notice">等待模型返回关键词...</span>`;
      } else if (!card.keywords.length) {
        keywordWrap.innerHTML = `<span class="notice">没有可展开关键词。</span>`;
      } else {
        card.keywords.forEach((keyword) => {
          const button = document.createElement("button");
          button.className = "keyword";
          button.type = "button";
          button.textContent = keyword.text;
          button.title = keyword.reason || keyword.query || keyword.text;
          button.addEventListener("click", () => {
            requestConcept(keyword.text, index, keyword);
          });
          keywordWrap.appendChild(button);
        });
      }

      const note = node.querySelector(".context-note");
      note.textContent = card.parentTitle
        ? `从「${card.parentTitle}」中的「${card.selectedFromParent || card.title}」展开`
        : "主概念";

      els.cards.appendChild(node);
    });

    renderPath();
    updateEmptyState();
    requestAnimationFrame(() => {
      els.cards.scrollLeft = els.cards.scrollWidth;
    });
  }

  function renderPath() {
    els.pathList.innerHTML = "";
    state.cards.forEach((card, index) => {
      const li = document.createElement("li");
      li.textContent = `${card.title}${card.loading ? " ..." : ""}`;
      li.title = card.answer || "";
      li.addEventListener("click", () => {
        state.cards = state.cards.slice(0, index + 1);
        renderCards();
      });
      els.pathList.appendChild(li);
    });
  }

  function updateEmptyState() {
    els.emptyState.hidden = state.cards.length > 0;
  }

  function showClientError(message) {
    state.cards = [{
      title: "配置不完整",
      type: "提示",
      answer: [
        message,
        "",
        "这个原型直接在浏览器里调用模型接口。",
        "",
        "- 不读取本地知识库",
        "- 不缓存结果",
        "- 每次查询都会重新请求模型"
      ].join("\n"),
      keywords: [],
      error: true
    }];
    renderCards();
  }

  function renderMarkdownLite(markdown) {
    const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    let html = "";
    let paragraph = [];
    let list = [];

    const flushParagraph = () => {
      if (paragraph.length) {
        html += `<p>${renderInline(paragraph.join(" "))}</p>`;
        paragraph = [];
      }
    };

    const flushList = () => {
      if (list.length) {
        html += `<ul>${list.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`;
        list = [];
      }
    };

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        flushParagraph();
        flushList();
        return;
      }

      if (trimmed.startsWith("### ")) {
        flushParagraph();
        flushList();
        html += `<h4>${renderInline(trimmed.slice(4))}</h4>`;
        return;
      }

      if (trimmed.startsWith("## ")) {
        flushParagraph();
        flushList();
        html += `<h3>${renderInline(trimmed.slice(3))}</h3>`;
        return;
      }

      if (/^[-*]\s+/.test(trimmed)) {
        flushParagraph();
        list.push(trimmed.replace(/^[-*]\s+/, ""));
        return;
      }

      flushList();
      paragraph.push(trimmed);
    });

    flushParagraph();
    flushList();
    return html || "<p></p>";
  }

  function renderInline(text) {
    return escapeHtml(text)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
