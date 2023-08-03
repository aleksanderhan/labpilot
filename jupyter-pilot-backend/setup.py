from setuptools import setup, find_packages

setup(
    name="jupyter-pilot-backend",
    version="0.1",
    packages=find_packages(),
    install_requires=[
        "tornado",
        # Note: Add any other dependencies your extension requires
    ],
    entry_points={
        "jupyter_server.extensions": [
            "jupyter-pilot-backend = jupyter_pilot_backend:load_jupyter_server_extension",
        ],
    },
)
