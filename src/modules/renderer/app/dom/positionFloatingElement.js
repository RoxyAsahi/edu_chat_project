function positionFloatingElement(element, rect, preferred = 'right', windowObj = window) {
    if (!element || !rect) {
        return;
    }

    const viewportPadding = 12;
    const gap = 10;
    const { innerWidth, innerHeight } = windowObj;
    const elementWidth = element.offsetWidth || 0;
    const elementHeight = element.offsetHeight || 0;

    let left = preferred === 'left'
        ? rect.left - elementWidth - gap
        : rect.right + gap;
    let top = rect.top;

    if (preferred === 'right' && left + elementWidth > innerWidth - viewportPadding) {
        left = Math.max(viewportPadding, rect.left - elementWidth - gap);
        top = Math.max(viewportPadding, rect.top - 4);
    } else if (preferred === 'left' && left < viewportPadding) {
        left = Math.min(innerWidth - elementWidth - viewportPadding, rect.right + gap);
    }

    if (top + elementHeight > innerHeight - viewportPadding) {
        top = Math.max(viewportPadding, rect.bottom - elementHeight);
    }

    top = Math.max(viewportPadding, Math.min(top, innerHeight - elementHeight - viewportPadding));
    left = Math.max(viewportPadding, Math.min(left, innerWidth - elementWidth - viewportPadding));

    element.style.left = `${Math.round(left)}px`;
    element.style.top = `${Math.round(top)}px`;
}

export {
    positionFloatingElement,
};
