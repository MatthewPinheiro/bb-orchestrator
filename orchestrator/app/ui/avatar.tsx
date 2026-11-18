import * as React from "react"
import { cn } from "./utils.ts"
import { Avatar as AvatarPrimitive } from "radix-ui"
import { styleHref } from "../style-href.ts"

// 2026-11-17: the sprite variant's idle bob, 2 px (keyframes can't be a utility class); off under reduced motion
const SPRITE_CSS = "@keyframes avatar-sprite-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }"

/**
 * 2026-11-17, two additions to shadcn's Avatar:
 * - sizes 16, 20, 24, 32, 40 and 48 px;
 * - variant "sprite" for pixel art (a Pokémon): no round crop and no fill, the image (an AvatarImage or a <picture>'s
 *   img) contained, pixelated and bobbing; the box is fixed from the first paint, so a late sprite moves nothing.
 */
function Avatar({
  className,
  size = "default",
  variant = "default",
  children,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root> & {
  size?: "default" | "sm" | "lg" | "16" | "20" | "24" | "32" | "40" | "48"
  variant?: "default" | "sprite"
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      data-variant={variant}
      className={cn(
        "group/avatar relative flex size-8 shrink-0 overflow-hidden rounded-full select-none data-[size=lg]:size-10 data-[size=sm]:size-6 data-[size=16]:size-4 data-[size=20]:size-5 data-[size=24]:size-6 data-[size=32]:size-8 data-[size=40]:size-10 data-[size=48]:size-12",
        "data-[variant=sprite]:items-center data-[variant=sprite]:justify-center data-[variant=sprite]:overflow-visible data-[variant=sprite]:rounded-none data-[variant=sprite]:bg-transparent data-[variant=sprite]:[&_picture]:contents data-[variant=sprite]:[&_img]:size-full data-[variant=sprite]:[&_img]:object-contain data-[variant=sprite]:[&_img]:[image-rendering:pixelated] motion-safe:data-[variant=sprite]:[&_img]:animate-[avatar-sprite-bob_3s_ease-in-out_infinite]",
        className
      )}
      {...props}
    >
      {variant === "sprite" ? (
        <style href={styleHref("avatar-sprite", SPRITE_CSS)} precedence="default">
          {SPRITE_CSS}
        </style>
      ) : null}
      {children}
    </AvatarPrimitive.Root>
  )
}

function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn("aspect-square size-full", className)}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center rounded-full bg-muted text-sm text-muted-foreground group-data-[size=sm]/avatar:text-xs group-data-[size=16]/avatar:text-xs group-data-[size=20]/avatar:text-xs group-data-[size=24]/avatar:text-xs",
        className
      )}
      {...props}
    />
  )
}

function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background select-none",
        "group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden",
        "group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2",
        "group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        "group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroupCount({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground ring-2 ring-background group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarBadge,
  AvatarGroup,
  AvatarGroupCount,
}
