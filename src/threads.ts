import axios, { AxiosError } from "axios";

const BASE_URL = "https://graph.threads.net/v1.0";

function getAccessToken(): string {
  const accessToken = process.env.THREADS_ACCESS_TOKEN;
  if (!accessToken) throw new Error("THREADS_ACCESS_TOKEN이 설정되지 않았습니다.");
  return accessToken;
}

export async function getThreadsUserId(accessToken: string): Promise<string> {
  const res = await axios.get(`${BASE_URL}/me`, {
    params: { fields: "id,username", access_token: accessToken },
    timeout: 10000,
  });
  console.log(`👤 Threads 유저: @${res.data.username} (ID: ${res.data.id})`);
  return res.data.id as string;
}

async function createContainer(text: string, accessToken: string, userId: string): Promise<string> {
  const res = await axios.post(
    `${BASE_URL}/${userId}/threads`,
    null,
    {
      params: { media_type: "TEXT", text, access_token: accessToken },
      timeout: 15000,
    }
  );
  return res.data.id as string;
}

async function publishContainer(containerId: string, accessToken: string, userId: string): Promise<string> {
  const res = await axios.post(
    `${BASE_URL}/${userId}/threads_publish`,
    null,
    {
      params: { creation_id: containerId, access_token: accessToken },
      timeout: 15000,
    }
  );
  return res.data.id as string;
}

export async function postToThreads(text: string): Promise<string> {
  const accessToken = getAccessToken();

  const userId = await getThreadsUserId(accessToken);

  try {
    console.log("📤 Threads 컨테이너 생성 중...");
    const containerId = await createContainer(text, accessToken, userId);

    await new Promise((r) => setTimeout(r, 2000));

    console.log("🚀 Threads에 게시 중...");
    const postId = await publishContainer(containerId, accessToken, userId);

    console.log(`✅ 게시 완료! Post ID: ${postId}`);
    return postId;
  } catch (err) {
    const axiosErr = err as AxiosError;
    const detail = JSON.stringify(axiosErr.response?.data ?? axiosErr.message);
    throw new Error(`Threads 게시 실패: ${detail}`);
  }
}

export function checkTokenExpiry(): void {
  console.log("ℹ️  Threads 토큰은 60일 유효합니다. 만료 전 갱신을 잊지 마세요.");
}
