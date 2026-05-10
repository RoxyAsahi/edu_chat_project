(function initUniStudyLucideAdapter() {
  const ICON_MAP = {
    add: 'Plus',
    add_link: 'Link2',
    analytics: 'ChartNoAxesCombined',
    article: 'FileText',
    arrow_back: 'ArrowLeft',
    arrow_circle_up: 'CircleArrowUp',
    arrow_forward: 'ArrowRight',
    assistant: 'Bot',
    auto_awesome: 'Sparkles',
    auto_stories: 'BookOpenText',
    autorenew: 'RefreshCw',
    bolt: 'Zap',
    cards_star: 'Layers',
    chat_bubble: 'MessageCircle',
    check: 'Check',
    check_box: 'SquareCheckBig',
    check_box_outline_blank: 'Square',
    check_circle: 'CircleCheck',
    chevron_right: 'ChevronRight',
    close: 'X',
    content_copy: 'Copy',
    content_cut: 'Scissors',
    content_paste: 'ClipboardPaste',
    create_new_folder: 'FolderPlus',
    crop_square: 'Square',
    dark_mode: 'Moon',
    database: 'Database',
    delete: 'Trash2',
    deployed_code_history: 'Boxes',
    description: 'FileText',
    deselect: 'ListX',
    done: 'Check',
    download: 'Download',
    draft: 'File',
    drafts: 'MailOpen',
    drag_indicator: 'GripVertical',
    drive_file_move: 'FolderInput',
    edit: 'Pencil',
    edit_document: 'FilePenLine',
    edit_note: 'NotepadText',
    error: 'TriangleAlert',
    event_note: 'NotebookText',
    expand_more: 'ChevronDown',
    folder: 'Folder',
    folder_off: 'FolderX',
    forum: 'MessagesSquare',
    home: 'House',
    hourglass_top: 'Hourglass',
    hub: 'Network',
    image: 'Image',
    library_books: 'LibraryBig',
    local_library: 'BookOpen',
    lock: 'Lock',
    lock_open: 'LockOpen',
    mark_chat_unread: 'MessageCircleMore',
    menu_book: 'BookOpen',
    monitor_heart: 'HeartPulse',
    mood: 'Smile',
    more_horiz: 'Ellipsis',
    more_vert: 'EllipsisVertical',
    navigate_before: 'ChevronLeft',
    navigate_next: 'ChevronRight',
    note_add: 'FilePlus2',
    open_in_new: 'ExternalLink',
    picture_as_pdf: 'FileText',
    post_add: 'FilePlus2',
    preview: 'Eye',
    progress_activity: 'LoaderCircle',
    psychology: 'Brain',
    quiz: 'CircleQuestionMark',
    radio_button_unchecked: 'Circle',
    refresh: 'RefreshCw',
    remove: 'Minus',
    replay: 'RotateCcw',
    restart_alt: 'RotateCw',
    save: 'Save',
    school: 'GraduationCap',
    science: 'FlaskConical',
    search: 'Search',
    search_off: 'SearchX',
    select_all: 'ListChecks',
    settings: 'Settings',
    shelves: 'Archive',
    smart_toy: 'Bot',
    stop_circle: 'CircleStop',
    style: 'PanelsTopLeft',
    swap_vert: 'ArrowUpDown',
    system_update_alt: 'Download',
    task_alt: 'CircleCheck',
    text_snippet: 'FileText',
    timer: 'Timer',
    trending_up: 'TrendingUp',
    tune: 'SlidersHorizontal',
    unfold_less: 'ChevronsUp',
    unfold_more: 'ChevronsDown',
    upload_file: 'FileUp',
    visibility: 'Eye',
    visibility_off: 'EyeOff',
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const lucide = window.lucide;

  if (!lucide?.icons) {
    return;
  }

  function toKebabCase(value) {
    return String(value || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/[\s_]+/g, '-')
      .toLowerCase();
  }

  function getIconToken(node) {
    const textToken = String(node.textContent || '').trim();
    if (textToken) {
      return textToken;
    }
    return String(node.dataset.lucideOriginalIcon || '').trim();
  }

  function createSvgElement(iconName, iconNode) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('width', '1em');
    svg.setAttribute('height', '1em');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.1');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.classList.add('lucide', 'unistudy-lucide-icon', `lucide-${toKebabCase(iconName)}`);

    iconNode.forEach(([tagName, attrs]) => {
      const child = document.createElementNS(SVG_NS, tagName);
      Object.entries(attrs || {}).forEach(([name, value]) => {
        child.setAttribute(name, value);
      });
      svg.appendChild(child);
    });

    return svg;
  }

  function renderLucideIcon(node) {
    if (!(node instanceof Element)) {
      return;
    }

    const token = getIconToken(node);
    if (!token) {
      return;
    }

    const iconName = ICON_MAP[token] || token;
    const iconNode = lucide.icons[iconName];
    if (!iconNode) {
      return;
    }

    if (node.dataset.lucideRendered === iconName && node.querySelector(':scope > svg.unistudy-lucide-icon')) {
      return;
    }

    node.dataset.lucideOriginalIcon = token;
    node.dataset.lucideRendered = iconName;
    node.replaceChildren(createSvgElement(iconName, iconNode));
  }

  function renderAll(root = document) {
    if (root instanceof Element && root.matches('.material-symbols-outlined')) {
      renderLucideIcon(root);
    }

    root.querySelectorAll?.('.material-symbols-outlined').forEach(renderLucideIcon);
  }

  let renderQueued = false;
  function queueRender() {
    if (renderQueued) {
      return;
    }
    renderQueued = true;
    const schedule = window.requestAnimationFrame || window.setTimeout;
    schedule(() => {
      renderQueued = false;
      renderAll(document);
    });
  }

  window.unistudyLucideIcons = {
    refresh: () => renderAll(document),
    render: renderAll,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => renderAll(document), { once: true });
  } else {
    renderAll(document);
  }

  const observer = new MutationObserver(queueRender);
  observer.observe(document.documentElement, {
    childList: true,
    characterData: true,
    subtree: true,
  });
})();
