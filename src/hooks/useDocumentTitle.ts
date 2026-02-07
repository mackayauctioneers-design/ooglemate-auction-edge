import { useEffect } from 'react';

const BASE_TITLE = 'Carbitrage';

export function useDocumentTitle(unreadCount: number) {
  useEffect(() => {
    if (unreadCount > 0) {
      document.title = `(${unreadCount}) ${BASE_TITLE}`;
    } else {
      document.title = BASE_TITLE;
    }

    return () => {
      document.title = BASE_TITLE;
    };
  }, [unreadCount]);
}
