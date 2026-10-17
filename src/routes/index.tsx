import { createFileRoute } from "@tanstack/react-router";
import { ReviewPage } from "#/components/review/review-page.tsx";

export const Route = createFileRoute("/")({ component: ReviewPage });
