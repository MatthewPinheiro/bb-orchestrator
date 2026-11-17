// Who the page is for: the ownerName and cosTitle settings, read once by the page (rpc `config`) and handed down.
import { createContext, useContext } from "react";
import type { Config } from "../contract.ts";

export const DEFAULT_IDENTITY: Config = { ownerName: "", cosTitle: "Chief of Staff", linearWorkspace: "", linearTeams: [] };
export const IdentityContext = createContext<Config>(DEFAULT_IDENTITY);
export const useIdentity = (): Config => useContext(IdentityContext);
