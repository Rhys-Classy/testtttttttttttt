// Entry point for the one-file build (npm run build:standalone). It mounts the
// same dashboard the Next.js app serves, with no server behind it.
import { createRoot } from "react-dom/client";
import Home from "../src/app/page";

const container = document.getElementById("root");
if (!container) throw new Error("SYNDICATE.OS could not start: the page has no #root element.");

createRoot(container).render(<Home />);
