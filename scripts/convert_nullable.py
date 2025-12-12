#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2025 SecPal Contributors
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Convert OpenAPI 3.0 nullable syntax to OpenAPI 3.1 compliant format.

In OpenAPI 3.0:
    type: string
    nullable: true

In OpenAPI 3.1 (this script converts to):
    type: [string, "null"]
"""

import re
import sys

def convert_nullable_to_type_array(yaml_content: str) -> str:
    """
    Convert OpenAPI 3.0 nullable fields to OpenAPI 3.1 type arrays.

    Handles patterns like:
        type: string
        format: date
        nullable: true

    Converts to:
        type: [string, "null"]
        format: date
    """
    lines = yaml_content.split('\n')
    result_lines = []

    i = 0
    while i < len(lines):
        line = lines[i]

        # Check if this line has a type declaration
        type_match = re.match(r'^(\s+)type:\s+(.+)$', line)

        if type_match:
            indent = type_match.group(1)
            type_value = type_match.group(2).strip()

            # Look ahead for format and/or nullable
            format_line = None
            nullable_line_idx = None

            j = i + 1
            while j < len(lines) and j < i + 5:  # Look max 5 lines ahead
                next_line = lines[j]

                # Check if we moved to a different property (less or equal indent without being a child)
                if re.match(f'^{indent}\\S', next_line):
                    break

                # Check for format with same indent
                if re.match(f'^{indent}format:\\s+', next_line):
                    format_line = next_line

                # Check for nullable with same indent
                if re.match(f'^{indent}nullable:\\s+true$', next_line):
                    nullable_line_idx = j
                    break

                j += 1

            # If we found nullable: true, convert
            if nullable_line_idx is not None:
                result_lines.append(f'{indent}type: [{type_value}, "null"]')

                # Add format line if it exists
                if format_line:
                    result_lines.append(format_line)

                # Skip all lines up to and including nullable
                i = nullable_line_idx + 1
            else:
                # No nullable: true found, keep the original type line and continue
                result_lines.append(line)
                i += 1
        else:
            # Not a type line, just copy as is
            result_lines.append(line)
            i += 1

    return '\n'.join(result_lines)


def main():
    """Read from stdin, convert, write to stdout."""
    yaml_content = sys.stdin.read()
    converted = convert_nullable_to_type_array(yaml_content)
    sys.stdout.write(converted)


if __name__ == '__main__':
    main()
