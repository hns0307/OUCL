import { useEffect, useRef, useState } from 'react';

const cache = new Map<string, Promise<string>>();
/** Lazy official project artwork with a stable fallback when offline, unavailable or malformed. */
export function ResourceIcon({ projectId, title }: { projectId: string; title: string }) {
  const holder = useRef<HTMLSpanElement>(null); const [icon, setIcon] = useState('');
  useEffect(() => {
    let active = true; setIcon(''); const node = holder.current; const bridge = window.oucl; if (!node || !bridge?.resourceIcon) return;
    const observer = new IntersectionObserver(entries => { if (!entries.some(entry => entry.isIntersecting)) return; observer.disconnect();
      let pending = cache.get(projectId);
      if (!pending) { pending = bridge.resourceIcon(projectId).then(result => result.ok ? result.data.icon : '').catch(() => ''); cache.set(projectId, pending); if (cache.size > 128) cache.delete(cache.keys().next().value!); }
      void pending.then(value => { if (active) setIcon(value); });
    }, { rootMargin: '150px' }); observer.observe(node);
    return () => { active = false; observer.disconnect(); };
  }, [projectId]);
  return <span className="resource-monogram" ref={holder}>{icon ? <img src={icon} alt="" draggable={false} /> : <span aria-hidden="true">{title.slice(0, 1)}</span>}</span>;
}
