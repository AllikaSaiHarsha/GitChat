import { useEffect } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

// Keep keyboard focus inside an open modal and return it to the opener.
export default function useModalFocus(containerRef, initialFocusRef) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const previouslyFocused = document.activeElement;
    (initialFocusRef?.current || container).focus();

    const onKeyDown = (event) => {
      if (event.key !== 'Tab') return;
      const focusable = [...container.querySelectorAll(FOCUSABLE)].filter(
        (element) => element.getClientRects().length > 0 && !element.closest('[inert]')
      );
      if (!focusable.length) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      if (typeof HTMLElement !== 'undefined' && previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [containerRef, initialFocusRef]);
}
