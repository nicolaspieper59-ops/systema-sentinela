# Makefile pour Systema Sentinela (SOFA + WASM Kernel)

CC = emcc
CXX = em++
CFLAGS = -O3 -std=c++17 -I lib/sofa/src -I src/
TARGET = ../wasm_astronomie.js

# Fichiers sources SOFA C et Wrapper C++
SRCS_C = $(wildcard lib/sofa/src/*.c)
SRCS_CPP = src/astro_engine.cpp

EXPORTS = "['_calculerParametresSiderauxEtSolaires','_calculerDepuisECEF','_normaliserDegres','_malloc','_free']"
EXTRA_METHODS = "['ccall','cwrap','HEAPF64','HEAP32','getValue','setValue']"

all: $(TARGET)

$(TARGET): $(SRCS_CPP) $(SRCS_C)
	$(CXX) $(CFLAGS) $(SRCS_CPP) $(SRCS_C) \
		-s WASM=1 \
		-s FORCE_FILESYSTEM=1 \
		-s ALLOW_MEMORY_GROWTH=1 \
		-s INITIAL_MEMORY=33554432 \
		-s EXPORTED_FUNCTIONS=$(EXPORTS) \
		-s EXPORTED_RUNTIME_METHODS=$(EXTRA_METHODS) \
		-o $(TARGET)

clean:
	rm -f $(TARGET) ../wasm_astronomie.wasm
