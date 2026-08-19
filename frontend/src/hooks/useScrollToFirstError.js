import { useCallback } from 'react';

export const useScrollToFirstError = (fieldOrder, fieldRefs) => {
  return useCallback((errors) => {
    if (!fieldRefs || !fieldRefs.current) return;

    const firstErrorKey = fieldOrder.find(key => errors[key]);
    
    if (firstErrorKey) {
      const fieldRef = fieldRefs.current[firstErrorKey];
      if (fieldRef) {
        fieldRef.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Focus the input if it's focusable
        if (fieldRef.focus) {
          // slight delay to allow smooth scroll to start
          setTimeout(() => fieldRef.focus(), 100);
        }
      }
    }
  }, [fieldOrder, fieldRefs]);
};
