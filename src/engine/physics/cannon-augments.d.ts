import "cannon-es";

declare module "cannon-es" {
    interface Body {
        /** Application-specific data attached to this body. */
        userData?: Record<string, unknown>;
    }
}
