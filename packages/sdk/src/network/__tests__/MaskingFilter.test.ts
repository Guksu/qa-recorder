import { describe, it, expect } from 'vitest';
import { MaskingFilter } from '../MaskingFilter.js';
import { resolveConfig } from '../../core/config.js';
import type { HAREntry } from '@qa-recorder/shared';

function makeEntry(
  requestHeaders: { name: string; value: string }[],
  responseHeaders: { name: string; value: string }[] = [],
): HAREntry {
  return {
    startedDateTime: new Date().toISOString(),
    time: 100,
    request: {
      method: 'GET',
      url: 'https://example.com',
      httpVersion: 'HTTP/1.1',
      headers: requestHeaders,
      queryString: [],
      bodySize: -1,
      headersSize: -1,
    },
    response: {
      status: 200,
      statusText: 'OK',
      httpVersion: 'HTTP/1.1',
      headers: responseHeaders,
      content: { size: 0, mimeType: 'application/json' },
      bodySize: 0,
      headersSize: -1,
    },
    timings: { send: 0, wait: 100, receive: 0 },
  };
}

function makeBodyEntry(opts: {
  url?: string;
  queryString?: { name: string; value: string }[];
  postData?: { mimeType: string; text: string };
  responseText?: string;
  responseMimeType?: string;
}): HAREntry {
  const entry = makeEntry([]);
  entry.request.url = opts.url ?? 'https://example.com/api';
  entry.request.queryString = opts.queryString ?? [];
  entry.request.postData = opts.postData;
  entry.response.content = {
    size: opts.responseText?.length ?? 0,
    mimeType: opts.responseMimeType ?? 'application/json',
  };
  if (opts.responseText !== undefined) entry.response.content.text = opts.responseText;
  return entry;
}

/** 실제 기본 설정의 maskKeys로 검증 (목록 자체는 config.test.ts에서 고정) */
const matcher = MaskingFilter.createKeyMatcher(resolveConfig().maskKeys);
const JSON_MIME = 'application/json';
const FORM_MIME = 'application/x-www-form-urlencoded';

describe('MaskingFilter.apply', () => {
  it('지정된 요청 헤더를 [MASKED]로 대체한다', () => {
    const entry = makeEntry([{ name: 'Authorization', value: 'Bearer secret' }]);
    const result = MaskingFilter.apply(entry, new Set(['authorization']), null);
    expect(result.request.headers[0].value).toBe('[MASKED]');
  });

  it('지정된 응답 헤더를 [MASKED]로 대체한다', () => {
    const entry = makeEntry([], [{ name: 'Set-Cookie', value: 'session=abc' }]);
    const result = MaskingFilter.apply(entry, new Set(['set-cookie']), null);
    expect(result.response.headers[0].value).toBe('[MASKED]');
  });

  it('헤더 이름은 대소문자를 구분하지 않는다', () => {
    const entry = makeEntry([{ name: 'AUTHORIZATION', value: 'Bearer secret' }]);
    const result = MaskingFilter.apply(entry, new Set(['authorization']), null);
    expect(result.request.headers[0].value).toBe('[MASKED]');
  });

  it('마스킹 목록에 없는 헤더는 원본 값을 유지한다', () => {
    const entry = makeEntry([{ name: 'Content-Type', value: 'application/json' }]);
    const result = MaskingFilter.apply(entry, new Set(['authorization']), null);
    expect(result.request.headers[0].value).toBe('application/json');
  });

  it('maskSet이 비어 있으면 아무것도 마스킹하지 않는다', () => {
    const entry = makeEntry([
      { name: 'Authorization', value: 'Bearer secret' },
      { name: 'Cookie', value: 'session=abc' },
    ]);
    const result = MaskingFilter.apply(entry, new Set(), null);
    expect(result.request.headers[0].value).toBe('Bearer secret');
    expect(result.request.headers[1].value).toBe('session=abc');
  });

  it('원본 entry를 변경하지 않는다 (불변성)', () => {
    const entry = makeEntry([{ name: 'Authorization', value: 'Bearer secret' }]);
    MaskingFilter.apply(entry, new Set(['authorization']), null);
    expect(entry.request.headers[0].value).toBe('Bearer secret');
  });

  it('body/쿼리를 마스킹해도 원본 entry는 변경되지 않는다', () => {
    const entry = makeBodyEntry({
      url: 'https://example.com/api?token=abc',
      queryString: [{ name: 'token', value: 'abc' }],
      postData: { mimeType: JSON_MIME, text: '{"password":"pw"}' },
      responseText: '{"token":"t"}',
    });
    MaskingFilter.apply(entry, new Set(), matcher);
    expect(entry.request.url).toBe('https://example.com/api?token=abc');
    expect(entry.request.queryString[0].value).toBe('abc');
    expect(entry.request.postData?.text).toBe('{"password":"pw"}');
    expect(entry.response.content.text).toBe('{"token":"t"}');
  });

  describe('요청 body', () => {
    it('JSON body의 중첩 객체와 배열 안의 민감 키를 재귀적으로 마스킹한다', () => {
      const body = {
        user: { email: 'a@b.com', password: 'pw1', profile: { apiKey: 'k' } },
        devices: [{ name: 'phone', pushToken: 'p1' }, { name: 'tablet', pushToken: 'p2' }],
        page: 1,
      };
      const entry = makeBodyEntry({ postData: { mimeType: JSON_MIME, text: JSON.stringify(body) } });
      const result = MaskingFilter.apply(entry, new Set(), matcher);
      expect(JSON.parse(result.request.postData!.text)).toEqual({
        user: { email: 'a@b.com', password: '[MASKED]', profile: { apiKey: '[MASKED]' } },
        devices: [{ name: 'phone', pushToken: '[MASKED]' }, { name: 'tablet', pushToken: '[MASKED]' }],
        page: 1,
      });
    });

    it('최상위가 배열인 JSON body도 마스킹한다', () => {
      const entry = makeBodyEntry({
        postData: { mimeType: JSON_MIME, text: '[{"otp":"123456"},{"otp":"654321"}]' },
      });
      const result = MaskingFilter.apply(entry, new Set(), matcher);
      expect(result.request.postData!.text).toBe('[{"otp":"[MASKED]"},{"otp":"[MASKED]"}]');
    });

    it('민감 키의 값이 객체나 숫자여도 통째로 마스킹한다', () => {
      const entry = makeBodyEntry({
        postData: { mimeType: JSON_MIME, text: '{"token":{"access":"a","refresh":"r"},"cvv":123}' },
      });
      const result = MaskingFilter.apply(entry, new Set(), matcher);
      expect(JSON.parse(result.request.postData!.text)).toEqual({ token: '[MASKED]', cvv: '[MASKED]' });
    });

    it('null과 빈 문자열 값은 비밀이 아니므로 유지한다', () => {
      const text = '{"token":null,"password":""}';
      const entry = makeBodyEntry({ postData: { mimeType: JSON_MIME, text } });
      const result = MaskingFilter.apply(entry, new Set(), matcher);
      expect(result.request.postData!.text).toBe(text);
    });

    it('마스킹할 키가 없으면 JSON 원문을 바이트 단위로 그대로 유지한다', () => {
      const text = '{ "name" : "홍길동",\n  "tags": ["a", "b"], "price": 1.50, "id": 12345678901234567890 }';
      const entry = makeBodyEntry({ postData: { mimeType: JSON_MIME, text } });
      const result = MaskingFilter.apply(entry, new Set(), matcher);
      expect(result.request.postData!.text).toBe(text);
    });

    it('마스킹이 일어나면 JSON을 compact하게 재직렬화한다', () => {
      const text = '{\n  "user": "kim",\n  "password": "pw"\n}';
      const entry = makeBodyEntry({ postData: { mimeType: JSON_MIME, text } });
      const result = MaskingFilter.apply(entry, new Set(), matcher);
      expect(result.request.postData!.text).toBe('{"user":"kim","password":"[MASKED]"}');
    });

    it('mimeType이 JSON이 아니어도 객체/배열로 파싱되는 텍스트는 JSON으로 마스킹한다', () => {
      const entry = makeBodyEntry({
        postData: { mimeType: 'text/plain;charset=UTF-8', text: '{"password":"pw"}' },
      });
      const result = MaskingFilter.apply(entry, new Set(), matcher);
      expect(result.request.postData!.text).toBe('{"password":"[MASKED]"}');
    });

    it('잘못된 JSON은 원문 그대로 유지한다', () => {
      const text = '{"password": "pw",';
      const entry = makeBodyEntry({ postData: { mimeType: JSON_MIME, text } });
      const result = MaskingFilter.apply(entry, new Set(), matcher);
      expect(result.request.postData!.text).toBe(text);
    });

    it('form-urlencoded body의 민감 필드만 마스킹하고 나머지 인코딩은 유지한다', () => {
      const text = 'username=kim+min&user%5Bpassword%5D=p%40ss&password_confirmation=p%40ss&remember=1';
      const entry = makeBodyEntry({ postData: { mimeType: `${FORM_MIME}; charset=UTF-8`, text } });
      const result = MaskingFilter.apply(entry, new Set(), matcher);
      expect(result.request.postData!.text).toBe(
        'username=kim+min&user%5Bpassword%5D=[MASKED]&password_confirmation=[MASKED]&remember=1',
      );
    });

    it('form-urlencoded body에 민감 필드가 없으면 원문을 유지한다', () => {
      const text = 'q=hello+world&page=2&flag';
      const entry = makeBodyEntry({ postData: { mimeType: FORM_MIME, text } });
      const result = MaskingFilter.apply(entry, new Set(), matcher);
      expect(result.request.postData!.text).toBe(text);
    });

    it('JSON도 form도 아닌 body는 그대로 유지한다', () => {
      const text = 'password=pw&token=t';
      const entry = makeBodyEntry({ postData: { mimeType: 'text/plain', text } });
      const result = MaskingFilter.apply(entry, new Set(), matcher);
      expect(result.request.postData!.text).toBe(text);
    });
  });

  describe('URL 쿼리', () => {
    it('URL 쿼리 파라미터 값과 queryString을 마스킹한다', () => {
      const entry = makeBodyEntry({
        url: 'https://example.com/cb?code=1&access_token=abc&state=x',
        queryString: [
          { name: 'code', value: '1' },
          { name: 'access_token', value: 'abc' },
          { name: 'state', value: 'x' },
        ],
      });
      const result = MaskingFilter.apply(entry, new Set(), matcher);
      expect(result.request.url).toBe('https://example.com/cb?code=1&access_token=[MASKED]&state=x');
      expect(result.request.queryString).toEqual([
        { name: 'code', value: '1' },
        { name: 'access_token', value: '[MASKED]' },
        { name: 'state', value: 'x' },
      ]);
    });

    it('매칭된 값만 바꾸고 URL의 나머지 인코딩과 fragment는 그대로 둔다', () => {
      const entry = makeBodyEntry({ url: '/search?q=a%20b+c&token=t%2Fx#section?token=keep' });
      const result = MaskingFilter.apply(entry, new Set(), matcher);
      expect(result.request.url).toBe('/search?q=a%20b+c&token=[MASKED]#section?token=keep');
    });

    it('매칭되는 파라미터가 없으면 URL을 그대로 유지한다', () => {
      const url = 'https://example.com/search?q=a%20b&page=2';
      const entry = makeBodyEntry({ url });
      const result = MaskingFilter.apply(entry, new Set(), matcher);
      expect(result.request.url).toBe(url);
    });
  });

  describe('응답 body', () => {
    it('응답 JSON body의 민감 키를 마스킹한다', () => {
      const entry = makeBodyEntry({
        responseText: '{"access_token":"a","refresh_token":"r","expires_in":3600,"user":{"id":1}}',
      });
      const result = MaskingFilter.apply(entry, new Set(), matcher);
      expect(JSON.parse(result.response.content.text!)).toEqual({
        access_token: '[MASKED]', refresh_token: '[MASKED]', expires_in: 3600, user: { id: 1 },
      });
    });

    it('AWS 임시 자격 증명 응답(Cognito GetCredentialsForIdentity)의 비밀 키를 가린다', () => {
      const entry = makeBodyEntry({
        responseText: '{"Credentials":{"AccessKeyId":"ASIA","Expiration":1,"SecretKey":"SKSK","SessionToken":"ST"},"IdentityId":"id-1"}',
        responseMimeType: 'application/x-amz-json-1.1',
      });
      const result = MaskingFilter.apply(entry, new Set(), matcher);
      expect(JSON.parse(result.response.content.text!)).toEqual({ Credentials: '[MASKED]', IdentityId: 'id-1' });
    });

    it('래퍼 키 이름이 없는 STS 형식에서도 SecretAccessKey와 SessionToken을 가린다', () => {
      const entry = makeBodyEntry({
        responseText: '{"AccessKeyId":"ASIA","SecretAccessKey":"wJalr","SessionToken":"IQo","aws_secret_access_key":"sk"}',
      });
      const result = MaskingFilter.apply(entry, new Set(), matcher);
      expect(JSON.parse(result.response.content.text!)).toEqual({
        AccessKeyId: 'ASIA', SecretAccessKey: '[MASKED]', SessionToken: '[MASKED]', aws_secret_access_key: '[MASKED]',
      });
    });

    it('복수형 래퍼 키(tokens)의 값은 하위 키 이름이 일반적이어도 통째로 가린다', () => {
      const entry = makeBodyEntry({
        responseText: '{"tokens":{"access":"eyJA","refresh":"eyJR"},"usage":{"total_tokens":30}}',
      });
      const result = MaskingFilter.apply(entry, new Set(), matcher);
      expect(JSON.parse(result.response.content.text!)).toEqual({
        tokens: '[MASKED]', usage: { total_tokens: 30 },
      });
    });

    it('로그인 응답의 jwt 키를 가린다 (Strapi 형식)', () => {
      const entry = makeBodyEntry({ responseText: '{"jwt":"J_SECRET","user":{"id":1}}' });
      const result = MaskingFilter.apply(entry, new Set(), matcher);
      expect(result.response.content.text).toBe('{"jwt":"[MASKED]","user":{"id":1}}');
    });

    it('응답 body의 mimeType으로 form-urlencoded를 판별한다', () => {
      const entry = makeBodyEntry({
        responseText: 'oauth_token=abc&oauth_token_secret=def&user_id=1',
        responseMimeType: FORM_MIME,
      });
      const result = MaskingFilter.apply(entry, new Set(), matcher);
      expect(result.response.content.text).toBe('oauth_token=[MASKED]&oauth_token_secret=[MASKED]&user_id=1');
    });

    it('응답 content.text가 없으면 text 필드를 추가하지 않는다', () => {
      const entry = makeBodyEntry({});
      const result = MaskingFilter.apply(entry, new Set(), matcher);
      expect('text' in result.response.content).toBe(false);
    });
  });

  it('keyMatcher가 null이면(maskKeys: []) body와 쿼리를 마스킹하지 않는다', () => {
    const entry = makeBodyEntry({
      url: 'https://example.com/api?token=abc',
      queryString: [{ name: 'token', value: 'abc' }],
      postData: { mimeType: JSON_MIME, text: '{"password":"pw"}' },
      responseText: '{"token":"t"}',
    });
    const result = MaskingFilter.apply(entry, new Set(), MaskingFilter.createKeyMatcher([]));
    expect(result.request.url).toBe('https://example.com/api?token=abc');
    expect(result.request.queryString[0].value).toBe('abc');
    expect(result.request.postData!.text).toBe('{"password":"pw"}');
    expect(result.response.content.text).toBe('{"token":"t"}');
  });
});

describe('MaskingFilter.createKeyMatcher', () => {
  it('maskKeys가 비어 있거나 정규화 후 빈 항목뿐이면 null을 반환한다', () => {
    expect(MaskingFilter.createKeyMatcher([])).toBeNull();
    expect(MaskingFilter.createKeyMatcher(['', '_-'])).toBeNull();
  });

  it.each([
    'password', 'PASSWORD', 'newPassword', 'confirm-password', 'user[password]',
    'access_token', 'refreshToken', 'id_token', 'x-api-key', 'API_KEY',
    'client_secret', 'JSESSIONID', 'card-number', 'cvv2',
    'password1', 'password2', 'password_confirmation', 'passwordConfirm',
    // 클라우드 비밀 키 (AWS Cognito/STS 응답의 SecretKey·SecretAccessKey, ~/.aws 형식, access_key 쿼리)
    'SecretKey', 'secret_key', 'SecretAccessKey', 'aws_secret_access_key', 'access_key',
    // 기타 자격 증명 (Strapi {jwt}, Bluesky accessJwt, Google Identity Services {credential})
    'jwt', 'accessJwt', 'credential', 'passphrase', 'passcode', 'otpCode', 'otp_code', 'totpCode',
  ])('기본 목록은 "%s" 키와 매칭된다 (대소문자·구분자 무시, 접미사/끝 숫자 허용)', (key) => {
    expect(matcher!(key)).toBe(true);
  });

  it.each([
    'tokens', 'Tokens', 'secrets', 'passwords', 'apiKeys', 'api_keys', 'credentials', 'Credentials', 'tokens2',
  ])('키 전체가 항목의 복수형인 "%s"도 매칭된다', (key) => {
    expect(matcher!(key)).toBe(true);
  });

  it.each([
    'username', 'email', 'max_tokens', 'tokenType', 'tokenizer', 'passwordPolicy',
    'className', 'screenshotPath', 'description', 'page', 'id',
    // 복수형은 접미사로 보지 않으므로 토큰 카운터는 그대로 둔다
    'total_tokens', 'prompt_tokens', 'completion_tokens', 'withCredentials',
    // 접두사 매칭을 하지 않으므로 password·otp·secret으로 시작하는 비밀이 아닌 키는 유지
    'passwordExpiresAt', 'otpEnabled', 'secretary',
    // 비밀이 아닌 AWS 식별자
    'AccessKeyId', 'aws_access_key_id',
  ])('기본 목록은 "%s" 키와 매칭되지 않는다', (key) => {
    expect(matcher!(key)).toBe(false);
  });

  it('접미사 매칭이라 nextPageToken 같은 비밀이 아닌 키도 마스킹된다 (문서화된 트레이드오프)', () => {
    expect(matcher!('nextPageToken')).toBe(true);
  });

  it('사용자 지정 항목도 정규화해서 비교한다', () => {
    const custom = MaskingFilter.createKeyMatcher(['Session_Key', '주민번호'])!;
    expect(custom('sessionKey')).toBe(true);
    expect(custom('X-Session-Key')).toBe(true);
    expect(custom('주민번호')).toBe(true);
    expect(custom('password')).toBe(false);
  });
});

describe('MaskingFilter.maskBody', () => {
  it('keyMatcher가 null이면 원문을 반환한다', () => {
    expect(MaskingFilter.maskBody('{"password":"pw"}', JSON_MIME, null)).toBe('{"password":"pw"}');
  });

  it('마스킹 중 예외가 나면 원문 대신 [MASKED]를 반환한다 (fail-closed)', () => {
    const throwing = () => { throw new Error('boom'); };
    expect(MaskingFilter.maskBody('{"password":"pw"}', JSON_MIME, throwing)).toBe('[MASKED]');
  });
});
