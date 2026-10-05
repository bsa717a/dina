import { ResetPasswordForm } from "@/app/reset-password/form";

export default async function ResetPasswordPage(props: PageProps<"/reset-password">) {
  const searchParams = await props.searchParams;
  const raw = searchParams.token;
  const token = (Array.isArray(raw) ? raw[0] : raw)?.trim() || "";
  return <ResetPasswordForm token={token} />;
}
