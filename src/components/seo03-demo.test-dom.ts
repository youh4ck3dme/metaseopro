/**
 * Minimal in-memory DOM for the Seo03Demo component tests.
 *
 * The repo has no jsdom / happy-dom / testing-library (and package.json is out
 * of scope for this change), so this implements just the surface React DOM 19
 * needs to mount, update and dispatch events for <Seo03Demo />, plus the
 * browser APIs the privacy test spies on (FileReader via File.text(),
 * XMLHttpRequest, Storage, indexedDB, navigator.sendBeacon, document.cookie).
 * It must be installed BEFORE react-dom is imported (React checks for a DOM
 * when the module loads). Test-only: nothing in the app imports this file.
 */

type Listener = { fn: (event: TestEvent) => void; capture: boolean };

export class TestEvent {
  type: string;
  bubbles: boolean;
  cancelable = true;
  defaultPrevented = false;
  isTrusted = false;
  timeStamp = Date.now();
  target: TestNode | null = null;
  currentTarget: TestNode | null = null;
  eventPhase = 0;
  button = 0;
  buttons = 0;
  detail = 1;
  private stopped = false;
  constructor(type: string, init: { bubbles?: boolean } = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? false;
  }
  get propagationStopped() {
    return this.stopped;
  }
  stopPropagation() {
    this.stopped = true;
  }
  stopImmediatePropagation() {
    this.stopped = true;
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
  getModifierState() {
    return false;
  }
}

export class TestNode {
  nodeType: number;
  nodeName: string;
  parentNode: TestNode | null = null;
  childNodes: TestNode[] = [];
  ownerDocument: TestDocument | null;
  private listeners = new Map<string, Listener[]>();

  constructor(nodeType: number, nodeName: string, ownerDocument: TestDocument | null) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.ownerDocument = ownerDocument;
  }
  get parentElement(): TestNode | null {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get nextSibling(): TestNode | null {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  get previousSibling(): TestNode | null {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    return siblings[siblings.indexOf(this) - 1] ?? null;
  }
  appendChild<T extends TestNode>(child: T): T {
    return this.insertBefore(child, null);
  }
  insertBefore<T extends TestNode>(child: T, ref: TestNode | null): T {
    if (child.parentNode) child.parentNode.removeChild(child);
    const index = ref ? this.childNodes.indexOf(ref) : -1;
    if (index === -1) this.childNodes.push(child);
    else this.childNodes.splice(index, 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild<T extends TestNode>(child: T): T {
    const index = this.childNodes.indexOf(child);
    if (index !== -1) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  contains(other: TestNode | null): boolean {
    for (let n = other; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join("");
  }
  set textContent(value: string) {
    for (const c of [...this.childNodes]) this.removeChild(c);
    if (value && this.ownerDocument) this.appendChild(this.ownerDocument.createTextNode(value));
  }
  addEventListener(
    type: string,
    fn: ((event: TestEvent) => void) | null,
    options?: boolean | { capture?: boolean },
  ) {
    if (!fn) return;
    const capture = typeof options === "boolean" ? options : !!options?.capture;
    const list = this.listeners.get(type) ?? [];
    if (!list.some((l) => l.fn === fn && l.capture === capture)) list.push({ fn, capture });
    this.listeners.set(type, list);
  }
  removeEventListener(
    type: string,
    fn: (event: TestEvent) => void,
    options?: boolean | { capture?: boolean },
  ) {
    const capture = typeof options === "boolean" ? options : !!options?.capture;
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((l) => !(l.fn === fn && l.capture === capture)),
    );
  }
  /** Capture phase top-down, then bubble phase bottom-up along parentNode. */
  dispatchEvent(event: TestEvent): boolean {
    event.target = this;
    const path: TestNode[] = [];
    path.push(this);
    for (let n = this.parentNode; n; n = n.parentNode) path.push(n);
    const run = (node: TestNode, capture: boolean) => {
      event.currentTarget = node;
      for (const l of [...(node.listeners.get(event.type) ?? [])]) {
        if (l.capture === capture) l.fn.call(node, event);
      }
    };
    for (let i = path.length - 1; i >= 0 && !event.propagationStopped; i--) {
      event.eventPhase = i === 0 ? 2 : 1;
      run(path[i], true);
    }
    for (let i = 0; i < path.length && !event.propagationStopped; i++) {
      if (i > 0 && !event.bubbles) break;
      event.eventPhase = i === 0 ? 2 : 3;
      run(path[i], false);
    }
    event.currentTarget = null;
    return !event.defaultPrevented;
  }
}

export class TestText extends TestNode {
  data: string;
  constructor(data: string, doc: TestDocument) {
    super(3, "#text", doc);
    this.data = data;
  }
  get nodeValue() {
    return this.data;
  }
  set nodeValue(v: string) {
    this.data = v;
  }
  override get textContent() {
    return this.data;
  }
  override set textContent(v: string) {
    this.data = v;
  }
}

export class TestComment extends TestNode {
  data: string;
  constructor(data: string, doc: TestDocument) {
    super(8, "#comment", doc);
    this.data = data;
  }
  override get textContent() {
    return "";
  }
  override set textContent(v: string) {
    this.data = v;
  }
}

export class TestElement extends TestNode {
  tagName: string;
  localName: string;
  namespaceURI: string;
  attributes = new Map<string, string>();
  style: Record<string, unknown> & { setProperty: (k: string, v: string) => void } = {
    setProperty(k: string, v: string) {
      this[k] = v;
    },
  };
  constructor(tag: string, doc: TestDocument, ns = "http://www.w3.org/1999/xhtml") {
    const name = ns.endsWith("xhtml") ? tag.toUpperCase() : tag;
    super(1, name, doc);
    this.tagName = name;
    this.localName = tag.toLowerCase();
    this.namespaceURI = ns;
  }
  setAttribute(name: string, value: unknown) {
    this.attributes.set(name, String(value));
  }
  setAttributeNS(_ns: string | null, name: string, value: unknown) {
    this.setAttribute(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  removeAttributeNS(_ns: string | null, name: string) {
    this.removeAttribute(name);
  }
  get id() {
    return this.getAttribute("id") ?? "";
  }
  get className() {
    return this.getAttribute("class") ?? "";
  }
  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
  blur() {
    if (this.ownerDocument?.activeElement === this)
      this.ownerDocument.activeElement = this.ownerDocument.body;
  }
  click() {
    this.dispatchEvent(new TestEvent("click", { bubbles: true }));
  }
  /** Tiny selector support: `tag`, `[attr="value"]` and `tag[attr="value"]`. */
  querySelectorAll(selector: string): TestElement[] {
    const m = /^([a-z0-9]*)(?:\[([a-z-]+)="([^"]*)"\])?$/i.exec(selector.trim());
    if (!m) throw new Error(`unsupported selector ${selector}`);
    const [, tag, attr, value] = m;
    const out: TestElement[] = [];
    const walk = (node: TestNode) => {
      for (const child of node.childNodes) {
        if (child instanceof TestElement) {
          const tagOk = !tag || child.localName === tag.toLowerCase();
          const attrOk = !attr || child.getAttribute(attr) === value;
          if (tagOk && attrOk) out.push(child);
          walk(child);
        }
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector: string): TestElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

export class TestHTMLElement extends TestElement {}
export class TestHTMLAnchorElement extends TestHTMLElement {
  href = "";
  download = "";
}
export class TestHTMLInputElement extends TestHTMLElement {
  type = "text";
  value = "";
  checked = false;
  files: File[] | null = null;
}
export class TestHTMLIFrameElement extends TestHTMLElement {}

export class TestDocument extends TestNode {
  documentElement: TestElement;
  head: TestElement;
  body: TestElement;
  activeElement: TestElement | null = null;
  defaultView: unknown = null;
  private cookieJar = "";
  constructor() {
    super(9, "#document", null);
    this.ownerDocument = null;
    this.documentElement = this.appendChild(this.createElement("html"));
    this.head = this.documentElement.appendChild(this.createElement("head"));
    this.body = this.documentElement.appendChild(this.createElement("body"));
    this.activeElement = this.body;
  }
  get cookie() {
    return this.cookieJar;
  }
  set cookie(value: string) {
    this.cookieJar = value;
  }
  createElement(tag: string): TestElement {
    const t = tag.toLowerCase();
    const El =
      t === "a"
        ? TestHTMLAnchorElement
        : t === "input"
          ? TestHTMLInputElement
          : t === "iframe"
            ? TestHTMLIFrameElement
            : TestHTMLElement;
    return new El(t, this);
  }
  createElementNS(ns: string, tag: string): TestElement {
    return ns.endsWith("xhtml") ? this.createElement(tag) : new TestElement(tag, this, ns);
  }
  createTextNode(data: string) {
    return new TestText(String(data), this);
  }
  createComment(data: string) {
    return new TestComment(String(data), this);
  }
  getElementById(id: string) {
    return this.documentElement.querySelector(`[id="${id}"]`);
  }
}

/** FileReader backed by `file.text()`, so a test can defer or reject that promise. */
export class TestFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null =
    null;
  readAsText(file: File) {
    file.text().then(
      (text) => {
        this.onprogress?.({ lengthComputable: true, loaded: file.size, total: file.size || 1 });
        this.result = text;
        this.onload?.();
      },
      () => this.onerror?.(),
    );
  }
}

export class TestStorage {
  private data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, String(v));
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
}

export class TestXMLHttpRequest {
  open() {}
  send() {}
}

const GLOBALS = [
  "window",
  "document",
  "Node",
  "Element",
  "HTMLElement",
  "HTMLAnchorElement",
  "HTMLInputElement",
  "HTMLIFrameElement",
  "FileReader",
  "XMLHttpRequest",
  "Storage",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "IS_REACT_ACT_ENVIRONMENT",
] as const;

/** Installs the DOM on globalThis and returns an uninstall function. */
export function installTestDom(): { document: TestDocument; uninstall: () => void } {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const key of GLOBALS) saved.set(key, Object.getOwnPropertyDescriptor(g, key));
  const nav = (g.navigator ?? {}) as Record<string, unknown>;
  const hadBeacon = "sendBeacon" in nav;

  const document = new TestDocument();
  document.defaultView = g;
  const values: Record<(typeof GLOBALS)[number], unknown> = {
    window: g,
    document,
    Node: TestNode,
    Element: TestElement,
    HTMLElement: TestHTMLElement,
    HTMLAnchorElement: TestHTMLAnchorElement,
    HTMLInputElement: TestHTMLInputElement,
    HTMLIFrameElement: TestHTMLIFrameElement,
    FileReader: TestFileReader,
    XMLHttpRequest: TestXMLHttpRequest,
    Storage: TestStorage,
    localStorage: new TestStorage(),
    sessionStorage: new TestStorage(),
    indexedDB: { open: () => ({}) },
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const key of GLOBALS) {
    Object.defineProperty(g, key, {
      value: values[key],
      configurable: true,
      writable: true,
    });
  }
  if (!hadBeacon) {
    Object.defineProperty(nav, "sendBeacon", {
      value: () => true,
      configurable: true,
      writable: true,
    });
  }

  return {
    document,
    uninstall() {
      for (const key of GLOBALS) {
        const d = saved.get(key);
        if (d) Object.defineProperty(g, key, d);
        else delete g[key];
      }
      if (!hadBeacon) delete nav.sendBeacon;
    },
  };
}
