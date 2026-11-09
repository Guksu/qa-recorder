/** har-schema(2.0.0)에는 타입 선언이 없다 — 스키마 이름별 JSON 스키마 객체 */
declare module 'har-schema' {
  const schemas: Record<string, object>;
  export default schemas;
}
