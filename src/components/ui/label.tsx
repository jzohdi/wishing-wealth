"use client";

import * as React from "react";

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
	({ className, ...props }, ref) => (
		<label
			ref={ref}
			className={`font-medium text-neutral-800 text-sm ${className ?? ""}`}
			{...props}
		/>
	),
);
Label.displayName = "Label";
