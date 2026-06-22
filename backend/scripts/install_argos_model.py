from __future__ import annotations

import sys

import argostranslate.package


FROM_CODE = "en"
TO_CODE = "ja"


def main() -> None:
    print(f"Installing Argos Translate model: {FROM_CODE} -> {TO_CODE}")

    argostranslate.package.update_package_index()
    available_packages = argostranslate.package.get_available_packages()

    matching_packages = [
        package
        for package in available_packages
        if package.from_code == FROM_CODE and package.to_code == TO_CODE
    ]

    if not matching_packages:
        print(f"No Argos Translate package found for {FROM_CODE} -> {TO_CODE}")
        sys.exit(1)

    package = matching_packages[0]
    download_path = package.download()
    argostranslate.package.install_from_path(download_path)

    print("Argos Translate model installed successfully.")


if __name__ == "__main__":
    main()
