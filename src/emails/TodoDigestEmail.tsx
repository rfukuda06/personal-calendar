import {
  Body,
  Container,
  Head,
  Html,
} from "@react-email/components";
import type { DigestTodos } from "@/lib/todos";

export function TodoDigestEmail({ today, rolledOver }: DigestTodos) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: "system-ui, sans-serif", padding: "24px" }}>
        <Container style={{ maxWidth: 480 }}>
          {today.length > 0 && (
            <>
              <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Today</h2>
              <ul style={{ paddingLeft: 20, marginTop: 0 }}>
                {today.map((t, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    {t.title}
                  </li>
                ))}
              </ul>
            </>
          )}
          {rolledOver.length > 0 && (
            <>
              <h2 style={{ fontSize: 16, margin: "16px 0 8px" }}>
                Rolled over
              </h2>
              <ul style={{ paddingLeft: 20, marginTop: 0 }}>
                {rolledOver.map((t, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    {t.title}{" "}
                    <span style={{ color: "#777" }}>(from {t.from})</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Container>
      </Body>
    </Html>
  );
}

export default TodoDigestEmail;
