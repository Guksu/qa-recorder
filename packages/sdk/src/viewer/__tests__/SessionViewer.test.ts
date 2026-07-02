import { describe, it, expect } from 'vitest';
import { SessionViewer } from '../SessionViewer.js';

function makeEvents() {
  return [
    { type: 2, data: { node: {} }, timestamp: 1000 },
    { type: 3, data: {}, timestamp: 1500 },
  ];
}

describe('SessionViewer.generate', () => {
  it('유효한 HTML 문서를 반환한다', () => {
    const html = SessionViewer.generate(makeEvents());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('이벤트 JSON이 HTML에 임베드된다', () => {
    const events = makeEvents();
    const html = SessionViewer.generate(events);
    expect(html).toContain(JSON.stringify(events));
  });

  it('플레이어 컨테이너 요소가 포함된다', () => {
    const html = SessionViewer.generate(makeEvents());
    expect(html).toContain('id="player"');
  });

  it('rrweb 스크립트 참조가 포함된다', () => {
    const html = SessionViewer.generate(makeEvents());
    expect(html).toMatch(/rrweb/);
  });

  it('이벤트가 비어있어도 오류 없이 동작한다', () => {
    expect(() => SessionViewer.generate([])).not.toThrow();
  });

  it('제목이 포함된다', () => {
    const html = SessionViewer.generate(makeEvents());
    expect(html).toContain('QA Session Replay');
  });

  it('이벤트 데이터에 </script>가 있어도 스크립트 블록이 깨지지 않는다', () => {
    const events = [{ type: 3, data: { text: '</script><script>alert(1)</script>' }, timestamp: 1000 }];
    const html = SessionViewer.generate(events);
    expect(html).not.toContain('</script><script>alert(1)');
  });
});
